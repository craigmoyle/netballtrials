import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(resetDb);

describe('Registration persistence', () => {
  it('stores a registration with ranked positions and a null third choice', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const reg = await prisma.registration.create({
      data: {
        ...registrationFixture(event.id),
        rank1Position: 'GS',
        rank2Position: 'WA',
        rank3Position: null,
      },
    });
    expect(reg.status).toBe('PENDING');
    expect(reg.rank3Position).toBeNull();
  });
  it('rejects two active registrations for the same event, name, and date of birth', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await prisma.registration.create({ data: registrationFixture(event.id) });
    await expect(prisma.registration.create({ data: registrationFixture(event.id) })).rejects.toMatchObject({ code: 'P2002' });
  });
  it('allows a new registration once the earlier one is expired', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const first = await prisma.registration.create({ data: registrationFixture(event.id) });
    await prisma.registration.update({ where: { id: first.id }, data: { status: 'EXPIRED' } });
    await expect(prisma.registration.create({ data: registrationFixture(event.id) })).resolves.toBeTruthy();
  });
});
