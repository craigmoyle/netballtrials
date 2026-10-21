import { Prisma, type PrismaClient } from '@prisma/client';

// A lease timeout cannot prove the worker has stopped using its recipient/payload.
export const INTERRUPTED_SEND = 'delivery_interrupted_after_claim';

/** Operator-only recovery; acknowledgement must come from stopping the worker, not claim age. */
export async function resolveStoppedDelivery(
  prisma: PrismaClient,
  input: { deliveryId: string; expectedAttempt: number; outcome: 'verified-sent' | 'unknown'; acknowledgeWorkerStopped: boolean },
  now: Date,
): Promise<{ eventId: string; deliveryId: string; attempt: number; status: 'SENT' | 'AMBIGUOUS' }> {
  if (input.acknowledgeWorkerStopped !== true) {
    throw new Error('Confirm the original worker is stopped with --acknowledge-worker-stopped before resolving a delivery');
  }
  if (!input.deliveryId.trim() || !Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 1 || input.expectedAttempt > 2_147_483_647) {
    throw new Error('A delivery id and a positive integer expected attempt are required');
  }
  if (input.outcome !== 'verified-sent' && input.outcome !== 'unknown') {
    throw new Error('Outcome must be verified-sent or unknown');
  }
  const changed = () => new Error('Delivery claim changed or is no longer unresolved; inspect it again before taking action');
  const delivery = await prisma.emailLog.findUnique({ where: { id: input.deliveryId }, select: { eventId: true } });
  if (!delivery) throw changed();

  return prisma.$transaction(async (tx) => {
    if (!await lockMailEvent(tx, delivery.eventId)) throw changed();
    const claim = await tx.emailLog.findUnique({
      where: { id: input.deliveryId },
      select: { eventId: true, status: true, attempts: true, lastAttemptAt: true, error: true, updatedAt: true },
    });
    if (!claim || claim.eventId !== delivery.eventId || claim.attempts !== input.expectedAttempt || !claim.lastAttemptAt ||
        !(claim.status === 'SENDING' || (claim.status === 'AMBIGUOUS' && claim.error === INTERRUPTED_SEND))) throw changed();

    const status = input.outcome === 'verified-sent' ? 'SENT' : 'AMBIGUOUS';
    const resolved = await tx.emailLog.updateMany({
      where: { id: input.deliveryId, ...claim },
      // Neither outcome matches the original worker's completion fence. Unknown is never automatically retried.
      data: { status, sentAt: status === 'SENT' ? now : null, failedAt: status === 'AMBIGUOUS' ? now : null,
        error: status === 'AMBIGUOUS' ? 'delivery_outcome_unknown' : null },
    });
    if (resolved.count !== 1) throw changed();
    return { eventId: delivery.eventId, deliveryId: input.deliveryId, attempt: claim.attempts, status };
  });
}

/** Lock Event before touching registrations or delivery rows; never hold over a send. */
export async function lockMailEvent(tx: Prisma.TransactionClient, eventId: string): Promise<{ eventDate: Date } | null> {
  const rows = await tx.$queryRaw<Array<{ eventDate: Date }>>(Prisma.sql`
    SELECT "eventDate" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE
  `);
  return rows[0] ?? null;
}

export function mailRegistrationEligibility(kind: string, now: Date): Prisma.RegistrationWhereInput {
  return {
    anonymizedAt: null,
    ...(kind === 'checkout'
      ? { status: 'PENDING', expiresAt: { gt: now } }
      : { status: 'PAID' }),
  };
}
