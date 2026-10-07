import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(resetDb);

describe('check-in schema', () => {
  it('tracks a bib number and arrival on a registration', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const reg = await prisma.registration.create({ data: registrationFixture(event.id) });
    const updated = await prisma.registration.update({
      where: { id: reg.id },
      data: { checkedInAt: new Date(), checkedInBy: 'Front desk', bibNumber: 7 },
    });
    expect(updated.bibNumber).toBe(7);
    expect(updated.checkedInAt).not.toBeNull();
  });
  it('stores a check-in session token hash per event', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const session = await prisma.checkInSession.create({
      data: { eventId: event.id, tokenHash: 'h'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
    });
    expect(session.eventId).toBe(event.id);
  });
  it('defaults the next bib number to 1', async () => {
    expect((await prisma.event.create({ data: eventFixture() })).nextBibNumber).toBe(1);
  });
});
