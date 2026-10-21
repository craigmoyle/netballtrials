import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { sendConfirmation } from '../registrations/confirmation';
import { AUTOMATIC_RETRY_LIMIT, retryFailedDeliveries } from './service';

// Leave the webhook time to send its own confirmation before cron steps in.
const WEBHOOK_GRACE_MS = 2 * 60_000;

export type ConfirmationRetryResult = {
  due: number;
  sent: number;
  failed: number;
  ambiguous: number;
  errors: number;
};

/**
 * Re-sends confirmation emails that the payment webhook could not deliver:
 * placeholder rows that were never hydrated and rows that definitely failed.
 * Ambiguous rows are left for an admin to decide.
 */
export async function retryPendingConfirmations(
  deps: { prisma: PrismaClient; mailer: EmailProvider; webOrigin: string },
  now: Date,
  options: { dryRun?: boolean } = {},
): Promise<ConfirmationRetryResult> {
  const rows = await deps.prisma.emailLog.findMany({
    where: {
      kind: 'confirmation',
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: AUTOMATIC_RETRY_LIMIT },
      createdAt: { lt: new Date(now.getTime() - WEBHOOK_GRACE_MS) },
      registration: { is: { status: 'PAID', anonymizedAt: null, qrToken: { not: null } } },
    },
    include: { registration: { include: { event: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const result: ConfirmationRetryResult = { due: rows.length, sent: 0, failed: 0, ambiguous: 0, errors: 0 };
  if (options.dryRun) return result;

  for (const row of rows) {
    const registration = row.registration!;
    try {
      if (row.status === 'PENDING' && row.messagePayload === null) {
        // Placeholder written by the webhook transaction: build and send the
        // real message through the same path as the admin retry.
        await sendConfirmation(
          { prisma: deps.prisma, mailer: deps.mailer },
          registration,
          registration.event,
          `${deps.webOrigin}/ticket/${registration.qrToken}`,
          { batchId: row.batchId },
        );
      } else {
        await retryFailedDeliveries(
          { prisma: deps.prisma, mailer: deps.mailer },
          row.eventId,
          row.batchId,
          [row.id],
          now,
          { maxAttempts: AUTOMATIC_RETRY_LIMIT },
        );
      }
      const after = await deps.prisma.emailLog.findUnique({ where: { id: row.id }, select: { status: true } });
      if (after?.status === 'SENT') result.sent += 1;
      else if (after?.status === 'FAILED') result.failed += 1;
      else if (after?.status === 'AMBIGUOUS') result.ambiguous += 1;
    } catch {
      result.errors += 1;
    }
  }
  return result;
}
