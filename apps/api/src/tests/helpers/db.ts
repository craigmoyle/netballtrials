import { prisma } from '../../db';

export async function resetDb(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.loginToken.deleteMany();
  await prisma.parentAccessSession.deleteMany();
  await prisma.parentAccessToken.deleteMany();
  await prisma.staffUser.deleteMany();
  await prisma.requestRateLimitBucket.deleteMany();
  await prisma.processedStripeEvent.deleteMany();
  await prisma.checkInSession.deleteMany();
  await prisma.scheduledMessage.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.emailTemplate.deleteMany();
  await prisma.reviewItem.deleteMany();
  await prisma.roundSlot.deleteMany();
  await prisma.roundPlan.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.eventPolicyDocument.deleteMany();
  await prisma.eventCourtColor.deleteMany();
  await prisma.event.deleteMany();
  await prisma.bibColor.deleteMany({ where: { name: { startsWith: 'Test ' } } });
  await prisma.memberAssociation.deleteMany();
}
