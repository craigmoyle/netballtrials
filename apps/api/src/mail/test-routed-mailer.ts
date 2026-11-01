import type { PrismaClient } from '@prisma/client';
import type { EmailMessage, EmailProvider } from './provider';

const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

export function createTestRoutedMailer(
  prisma: PrismaClient,
  liveMailer: EmailProvider & { provider: 'gmail-api' },
  liveRecipients: string[],
): EmailProvider & { provider: 'gmail-api' } {
  const allowedRecipients = new Set(liveRecipients.map((email) => email.trim().toLowerCase()));
  return {
    provider: 'gmail-api',
    async send(message: EmailMessage) {
      const to = message.to.trim().toLowerCase();
      if (allowedRecipients.has(to)) return liveMailer.send({ ...message, to });

      const now = new Date();
      await prisma.testEmailOutbox.deleteMany({ where: { expiresAt: { lte: now } } });
      await prisma.testEmailOutbox.create({
        data: {
          to,
          subject: message.subject,
          body: message.text,
          html: message.html ?? null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + OUTBOX_TTL_MS),
        },
      });
      return 'simulated';
    },
  };
}
