import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { updateEvent } from '../../events/service';
import { ensureReviewItems, listReviewQueue, resolveReviewItem } from '../../review/service';
import { seedPaidFlagged } from '../helpers/review';

beforeEach(resetDb);

describe('review queue', () => {
  it('creates one item per flagged registration and is idempotent', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await seedPaidFlagged(event.id);
    expect(await ensureReviewItems(prisma, event.id)).toBe(1);
    expect(await ensureReviewItems(prisma, event.id)).toBe(0);
    expect(await listReviewQueue(prisma, event.id)).toHaveLength(1);
  });
  it('creates one review item when concurrent workers both observe an empty queue', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await seedPaidFlagged(event.id);
    const originalFindMany = prisma.registration.findMany.bind(prisma.registration);
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    const synchronizedFindMany = async (args: Parameters<typeof prisma.registration.findMany>[0]) => {
      const rows = await originalFindMany(args);
      reads += 1;
      if (reads === 2) release();
      await bothRead;
      return rows;
    };
    const findMany = vi.spyOn(prisma.registration, 'findMany').mockImplementation(
      synchronizedFindMany as unknown as typeof prisma.registration.findMany,
    );
    const results = await Promise.all([
      ensureReviewItems(prisma, event.id),
      ensureReviewItems(prisma, event.id),
    ]);
    findMany.mockRestore();
    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await prisma.reviewItem.count({ where: { eventId: event.id, reason: 'age_out_of_range' } })).toBe(1);
  });

  it('records who resolved an item and when', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await seedPaidFlagged(event.id);
    await ensureReviewItems(prisma, event.id);
    const item = (await listReviewQueue(prisma, event.id))[0];
    const now = new Date('2026-09-01T00:00:00Z');
    const resolved = await resolveReviewItem(
      prisma,
      event.id,
      item.id,
      { resolvedByUserId: 'u1', note: 'Checked with association' },
      now,
    );
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(resolved?.resolvedByUserId).toBe('u1');
    expect(await listReviewQueue(prisma, event.id)).toHaveLength(0);
    expect(await ensureReviewItems(prisma, event.id)).toBe(0);
    expect(await listReviewQueue(prisma, event.id, true)).toMatchObject([
      { id: item.id, resolvedByUserId: 'u1', note: 'Checked with association' },
    ]);
  });
  it('removes withdrawn flagged players from the open queue', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const registration = await seedPaidFlagged(event.id);
    await ensureReviewItems(prisma, event.id);
    expect(await listReviewQueue(prisma, event.id)).toHaveLength(1);
    await prisma.registration.update({ where: { id: registration.id }, data: { status: 'WITHDRAWN' } });
    expect(await listReviewQueue(prisma, event.id)).toHaveLength(0);
    expect(await listReviewQueue(prisma, event.id, true)).toHaveLength(1);
  });

  it('hides stale age reviews after a range update without hiding payment items or losing history', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const registration = await seedPaidFlagged(event.id);
    const resolvedRegistration = await prisma.registration.create({
      data: registrationFixture(event.id, {
        status: 'PAID', ageFlagged: true, playerFirstName: 'Bea', playerNameNormalized: 'bea lovelace',
      }),
    });
    await ensureReviewItems(prisma, event.id);
    const ageItem = await prisma.reviewItem.findFirstOrThrow({ where: { registrationId: registration.id } });
    const resolvedItem = await prisma.reviewItem.findFirstOrThrow({ where: { registrationId: resolvedRegistration.id } });
    await resolveReviewItem(prisma, event.id, resolvedItem.id, { resolvedByUserId: 'u1', note: 'Approved' }, new Date());
    const withdrawn = await prisma.registration.create({ data: registrationFixture(event.id, { status: 'WITHDRAWN' }) });
    const paymentItems = await Promise.all([registration.id, withdrawn.id].map((registrationId) => prisma.reviewItem.create({
      data: { eventId: event.id, registrationId, reason: 'payment_without_registration', note: 'Payment needs review' },
    })));
    const otherItem = await prisma.reviewItem.create({
      data: { eventId: event.id, registrationId: registration.id, reason: 'other' },
    });
    expect(await listReviewQueue(prisma, event.id)).toHaveLength(4);

    await updateEvent(prisma, event.id, { maxAge: 16 });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).ageFlagged).toBe(false);
    expect(await ensureReviewItems(prisma, event.id)).toBe(0);
    const queue = await listReviewQueue(prisma, event.id);
    expect(queue.map((item) => item.id).sort()).toEqual([...paymentItems.map((item) => item.id), otherItem.id].sort());
    const history = await listReviewQueue(prisma, event.id, true);
    expect(history).toHaveLength(5);
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ageItem.id, resolvedAt: null, registration: expect.objectContaining({ ageFlagged: false }) }),
      expect.objectContaining({ id: resolvedItem.id, resolvedByUserId: 'u1', note: 'Approved' }),
    ]));

    await updateEvent(prisma, event.id, { maxAge: 15 });
    expect(await ensureReviewItems(prisma, event.id)).toBe(0);
    expect((await listReviewQueue(prisma, event.id)).map((item) => item.id)).toContain(ageItem.id);
    expect((await listReviewQueue(prisma, event.id)).map((item) => item.id)).not.toContain(resolvedItem.id);
  });

  it('keeps the original item note when an admin resolves it', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const registration = await seedPaidFlagged(event.id);
    const item = await prisma.reviewItem.create({
      data: { eventId: event.id, registrationId: registration.id, reason: 'payment_without_registration', note: 'Stripe payment pi_123' },
    });
    const resolved = await resolveReviewItem(prisma, event.id, item.id, { resolvedByUserId: 'u1', note: 'Refunded' }, new Date());
    expect(resolved?.note).toBe('Stripe payment pi_123\n\nResolution: Refunded');
    const unchanged = await prisma.reviewItem.create({
      data: { eventId: event.id, registrationId: registration.id, reason: 'other', note: 'Original' },
    });
    expect((await resolveReviewItem(prisma, event.id, unchanged.id, { resolvedByUserId: 'u1' }, new Date()))?.note).toBe('Original');
  });

  it('does not overwrite an existing resolution', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await seedPaidFlagged(event.id);
    await ensureReviewItems(prisma, event.id);
    const item = (await listReviewQueue(prisma, event.id))[0];
    await resolveReviewItem(
      prisma,
      event.id,
      item.id,
      { resolvedByUserId: 'u1', note: 'first' },
      new Date('2026-09-01T00:00:00Z'),
    );
    await resolveReviewItem(
      prisma,
      event.id,
      item.id,
      { resolvedByUserId: 'u2', note: 'second' },
      new Date('2026-09-02T00:00:00Z'),
    );
    const row = await prisma.reviewItem.findUnique({ where: { id: item.id } });
    expect(row?.resolvedByUserId).toBe('u1');
  });
});
