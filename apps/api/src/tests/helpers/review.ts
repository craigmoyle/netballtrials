import { prisma } from '../../db';
import { registrationFixture } from './fixtures';

export async function seedPaidFlagged(eventId: string) {
  return prisma.registration.create({
    data: registrationFixture(eventId, {
      status: 'PAID',
      ageFlagged: true,
    }),
  });
}
