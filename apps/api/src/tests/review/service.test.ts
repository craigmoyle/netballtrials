import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';
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
