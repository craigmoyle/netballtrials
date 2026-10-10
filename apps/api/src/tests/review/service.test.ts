import { describe, it, expect, beforeEach } from 'vitest';
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
