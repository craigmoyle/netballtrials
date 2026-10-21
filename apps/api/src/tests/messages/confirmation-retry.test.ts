import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { createDevMailer } from '../../mail/dev-mailer';
import { GmailDeliveryError } from '../../mail/gmail-mailer';
import { retryPendingConfirmations } from '../../messages/confirmation-retry';
import { confirmPayment } from '../../payments/webhook';
import { sendConfirmation } from '../../registrations/confirmation';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

const WEB_ORIGIN = 'https://trials.example';
const now = new Date('2026-09-01T10:00:00Z');
const old = new Date(now.getTime() - 10 * 60_000);

beforeEach(resetDb);

async function paidRegistration(eventId: string, email: string, sessionId: string) {
  const registration = await prisma.registration.create({
    data: registrationFixture(eventId, { parentEmail: email, checkoutSessionId: sessionId, playerFirstName: sessionId, playerNameNormalized: `${sessionId} lovelace` }),
  });
  await confirmPayment(prisma, {
    kind: 'checkout_completed', stripeEventId: `evt_${sessionId}`, registrationId: registration.id,
    sessionId, amountCents: 3500, currency: 'aud', paymentStatus: 'paid', paymentIntentId: `pi_${sessionId}`,
  }, now);
  return prisma.registration.findUniqueOrThrow({ where: { id: registration.id }, include: { event: true } });
}

describe('retryPendingConfirmations', () => {
  it('sends stale placeholder and failed confirmations but leaves fresh, capped and unpaid rows alone', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
    const placeholder = await paidRegistration(event.id, 'placeholder@example.com', 'cs_placeholder');
    const failed = await paidRegistration(event.id, 'failed@example.com', 'cs_failed');
    const fresh = await paidRegistration(event.id, 'fresh@example.com', 'cs_fresh');
    const capped = await paidRegistration(event.id, 'capped@example.com', 'cs_capped');
    const withdrawn = await paidRegistration(event.id, 'withdrawn@example.com', 'cs_withdrawn');

    const rejecting = { send: async () => { throw new GmailDeliveryError('rejected', 403); } };
    await sendConfirmation({ prisma, mailer: rejecting }, failed, failed.event, `${WEB_ORIGIN}/ticket/${failed.qrToken}`);
    expect((await prisma.emailLog.findFirstOrThrow({ where: { registrationId: failed.id } })).status).toBe('FAILED');

    await prisma.emailLog.updateMany({ where: { registrationId: { not: fresh.id } }, data: { createdAt: old } });
    await prisma.emailLog.updateMany({ where: { registrationId: capped.id }, data: { status: 'FAILED', attempts: 5 } });
    await prisma.registration.update({ where: { id: withdrawn.id }, data: { status: 'WITHDRAWN' } });

    const dryMailer = createDevMailer([]);
    const dry = await retryPendingConfirmations({ prisma, mailer: dryMailer, webOrigin: WEB_ORIGIN }, now, { dryRun: true });
    expect(dry).toMatchObject({ due: 2, sent: 0 });
    expect(dryMailer.sent).toHaveLength(0);

    const mailer = createDevMailer([]);
    const result = await retryPendingConfirmations({ prisma, mailer, webOrigin: WEB_ORIGIN }, now);
    expect(result).toMatchObject({ due: 2, sent: 2, failed: 0, ambiguous: 0, errors: 0 });
    expect(mailer.sent.map((message) => message.to).sort()).toEqual(['failed@example.com', 'placeholder@example.com']);

    const statuses = Object.fromEntries((await prisma.emailLog.findMany({ include: { registration: true } }))
      .map((log) => [log.registration!.parentEmail, log.status]));
    expect(statuses).toEqual({
      'placeholder@example.com': 'SENT',
      'failed@example.com': 'SENT',
      'fresh@example.com': 'PENDING',
      'capped@example.com': 'FAILED',
      'withdrawn@example.com': 'PENDING',
    });
    const hydrated = await prisma.emailLog.findFirstOrThrow({ where: { registrationId: placeholder.id } });
    expect((hydrated.messagePayload as { inlineImages: { cid: string }[] }).inlineImages[0].cid).toBe('ticket-qr');

    const again = await retryPendingConfirmations({ prisma, mailer, webOrigin: WEB_ORIGIN }, now);
    expect(again.due).toBe(0);
    expect(mailer.sent).toHaveLength(2);
  });
});
