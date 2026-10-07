import { prisma } from '../../db';

export async function resetDb(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.loginToken.deleteMany();
  await prisma.staffUser.deleteMany();
  await prisma.event.deleteMany();
  await prisma.memberAssociation.deleteMany();
}
