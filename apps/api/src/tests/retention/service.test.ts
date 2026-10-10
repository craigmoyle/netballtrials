import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { anonymizeExpiredRegistrations } from '../../retention/service';
import { eventFixture, registrationFixture as regFixture } from '../helpers/fixtures';

beforeEach(resetDb);

describe('anonymizeExpiredRegistrations', () => {
  it('blanks personal fields after 12 months and keeps the record', async () => {
    const old = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2025-09-12T00:00:00Z') },
    });
    const recent = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z') },
    });
    await prisma.registration.create({ data: { ...regFixture(old.id), status: 'PAID' } });
    await prisma.registration.create({ data: { ...regFixture(recent.id), status: 'PAID' } });
    const count = await anonymizeExpiredRegistrations(prisma, new Date('2026-10-07T00:00:00Z'));
    expect(count).toBe(1);
    const anonymised = await prisma.registration.findFirst({ where: { eventId: old.id } });
    expect(anonymised?.playerFirstName).toBe('');
    expect(anonymised?.parentEmail).toBe('');
    expect(anonymised?.dateOfBirth.toISOString()).toContain('1900-01-01');
    expect(
      (await prisma.registration.findFirst({ where: { eventId: recent.id } }))?.parentEmail,
    ).toBe('anne@example.com');
  });
});
