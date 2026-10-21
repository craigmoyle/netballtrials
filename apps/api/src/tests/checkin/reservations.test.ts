import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../db';
import { hashPin } from '../../checkin/pin';
import { openCheckInSession, PinInvalidError, PinLockedError } from '../../checkin/service';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';

const now = new Date('2026-09-12T00:00:00Z');
let eventId: string;
let failureKey: string;

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: eventFixture({ checkInPinHash: await hashPin('482193') }) });
  eventId = event.id;
  failureKey = `checkin-fail:${event.id}:${event.checkInPinVersion}`;
});
afterEach(() => vi.restoreAllMocks());

function pauseReservations(key: string, count: number) {
  let signal!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => { signal = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const queryRaw = prisma.$queryRaw.bind(prisma);
  let calls = 0;
  // Pause after the real database reservation, before the caller can verify/refund it.
  vi.spyOn(prisma, '$queryRaw').mockImplementation((async (...args: Parameters<typeof prisma.$queryRaw>) => {
    const rows = await queryRaw(...args);
    const query = args[0];
    if ('values' in query && Array.isArray(query.values) && query.values[0] === key) {
      calls += 1;
      if (calls <= count) {
        if (calls === count) signal();
        await released;
      }
    }
    return rows;
  }) as typeof prisma.$queryRaw);
  return { reached, release };
}

const attempt = (pin: string, clientKey: string, at = now) => openCheckInSession(
  { prisma }, { eventId, pin, clientKey }, at,
);
const hits = async () => (await prisma.requestRateLimitBucket.findUniqueOrThrow({ where: { key: failureKey } })).hits;

describe('event-wide PIN reservations', () => {
  it('does not charge a denied overlapping correct PIN after 29 wrong PINs', async () => {
    for (let i = 0; i < 29; i++) {
      await expect(attempt('000000', `wrong-${i}`)).rejects.toBeInstanceOf(PinInvalidError);
    }
    const pause = pauseReservations(failureKey, 2);
    const attempts = Promise.allSettled([attempt('482193', 'correct-1'), attempt('482193', 'correct-2')]);
    let reservedHits: number;
    try {
      await pause.reached;
      reservedHits = await hits();
    } finally {
      pause.release();
    }
    const results = await attempts;
    expect(reservedHits).toBe(30);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.any(PinLockedError) }),
    ]);
    expect(await hits()).toBe(29);
    await expect(attempt('482193', 'correct-3', new Date(now.getTime() + 1000))).resolves.toHaveProperty('token');
    expect(await hits()).toBe(29);
  });

  it('does not refund an expired reservation into the next window', async () => {
    const pause = pauseReservations(failureKey, 1);
    const pending = Promise.allSettled([attempt('482193', 'old-window-correct')]);
    const nextWindow = new Date(now.getTime() + 10 * 60_000);
    try {
      await pause.reached;
      await expect(attempt('000000', 'new-window-wrong', nextWindow)).rejects.toBeInstanceOf(PinInvalidError);
    } finally {
      pause.release();
    }
    expect((await pending)[0].status).toBe('fulfilled');
    expect(await prisma.requestRateLimitBucket.findUniqueOrThrow({ where: { key: failureKey } })).toMatchObject({
      hits: 1, windowStartedAt: nextWindow,
    });
    await expect(attempt('482193', 'new-window-correct', nextWindow)).resolves.toHaveProperty('token');
    expect(await hits()).toBe(1);
  });
});
