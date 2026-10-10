import { prisma } from '../../db';

export async function resetDb(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.loginToken.deleteMany();
  await prisma.staffUser.deleteMany();
  await prisma.checkInSession.deleteMany();
  await prisma.roundSlot.deleteMany();
  await prisma.roundPlan.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.event.deleteMany();
  await prisma.memberAssociation.deleteMany();
}
