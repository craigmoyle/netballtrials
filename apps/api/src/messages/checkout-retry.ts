import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { mailRegistrationEligibility } from '../mail/lifecycle';
import { isPastRetentionCutoff } from '../retention/service';
import { AUTOMATIC_RETRY_LIMIT, retryFailedDeliveries } from './service';

/** Retry only known-unsent checkout mail, never recreate a checkout session. */
export async function retryPendingCheckouts(
  deps: { prisma: PrismaClient; mailer: EmailProvider },
  now: Date,
  options: { dryRun?: boolean } = {},
): Promise<{ due: number; sent: number; failed: number; ambiguous: number; errors: number }> {
  const candidates = await deps.prisma.emailLog.findMany({
    where: {
      kind: 'checkout',
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: AUTOMATIC_RETRY_LIMIT },
      createdAt: { lt: new Date(now.getTime() - 2 * 60_000) },
      registration: { is: mailRegistrationEligibility('checkout', now) },
    },
    include: { event: { select: { eventDate: true } }, registration: { select: { parentEmail: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const rows = candidates.filter((row) =>
    row.registration?.parentEmail.toLowerCase() === row.to.toLowerCase() && !isPastRetentionCutoff(row.event.eventDate, now),
  );
  const result = { due: rows.length, sent: 0, failed: 0, ambiguous: 0, errors: 0 };
  if (options.dryRun) return result;

  for (const row of rows) {
    try {
      const delivery = await retryFailedDeliveries(deps, row.eventId, row.batchId, [row.id], now, { maxAttempts: AUTOMATIC_RETRY_LIMIT });
      result.sent += delivery.sentThisRun;
      result.failed += delivery.failedThisRun;
      result.ambiguous += delivery.ambiguousThisRun;
    } catch {
      result.errors += 1;
    }
  }
  return result;
}
