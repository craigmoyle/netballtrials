import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';

export async function deliverEventMessage(
  deps: { prisma: PrismaClient; mailer: EmailProvider },
  eventId: string,
  message: { subject: string; text: string },
  now: Date,
  kind: string,
): Promise<{ sent: number; failed: number }> {
  const registrations = await deps.prisma.registration.findMany({
    where: { eventId, status: 'PAID' },
    select: { id: true, parentEmail: true },
  });

  const recipients = new Map<string, string>();
  for (const registration of registrations) {
    if (!recipients.has(registration.parentEmail)) {
      recipients.set(registration.parentEmail, registration.id);
    }
  }

  let sent = 0;
  let failed = 0;

  for (const [to, registrationId] of recipients) {
    try {
      await deps.mailer.send({ to, subject: message.subject, text: message.text });
      await deps.prisma.emailLog.create({
        data: {
          eventId,
          registrationId,
          to,
          subject: message.subject,
          kind,
          body: message.text,
          sentAt: now,
        },
      });
      sent += 1;
    } catch (error) {
      await deps.prisma.emailLog.create({
        data: {
          eventId,
          registrationId,
          to,
          subject: message.subject,
          kind,
          body: message.text,
          failedAt: now,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      failed += 1;
    }
  }

  return { sent, failed };
}

export async function sendEventMessage(
  deps: { prisma: PrismaClient; mailer: EmailProvider },
  eventId: string,
  message: { subject: string; text: string },
  now: Date,
): Promise<{ sent: number; failed: number }> {
  return deliverEventMessage(deps, eventId, message, now, 'message');
}
