import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../db';
import { createDevMailer } from '../../mail/dev-mailer';
import { INTERRUPTED_SEND, resolveStoppedDelivery } from '../../mail/lifecycle';
import { reconcileStaleDeliveries, retryFailedDeliveries, sendEventMessage } from '../../messages/service';
import { anonymizeExpiredRegistrations, type RetentionDeferral } from '../../retention/service';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(resetDb);
const beforeCutoff = new Date('2024-01-01T12:59:00Z');
const afterCutoff = new Date('2024-01-01T13:01:00Z');
const content = { subject: 'Private details', text: 'Contact Anne', html: '<p>Private</p>' };

async function setup() {
  const event = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2020-01-01T00:00:00Z') }) });
  const registration = await prisma.registration.create({ data: registrationFixture(event.id, { status: 'PAID' }) });
  return { event, registration };
}

async function abandonedClaim() {
  const { event, registration } = await setup();
  const delivery = await prisma.emailLog.create({ data: {
    eventId: event.id, registrationId: registration.id, batchId: 'dead-worker', idempotencyKey: 'dead-worker',
    to: registration.parentEmail, kind: 'message', subject: content.subject, body: content.text,
    messagePayload: { html: content.html }, status: 'SENDING', attempts: 2, lastAttemptAt: beforeCutoff,
  } });
  return { event, registration, delivery };
}

function resolution(deliveryId: string, outcome: 'unknown' | 'verified-sent' = 'unknown') {
  return { deliveryId, expectedAttempt: 2, outcome, acknowledgeWorkerStopped: true };
}

function runScript(script: string, args: string[] = []) {
  return spawnSync(process.execPath, ['--import', 'tsx', `src/scripts/${script}.ts`, ...args], {
    cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8', timeout: 20_000,
  });
}

describe('operator recovery of abandoned mail claims', () => {
  it('reports an abandoned claim indefinitely, before and after stale reconciliation', async () => {
    const { event, delivery } = await abandonedClaim();
    const reports: RetentionDeferral[] = [];
    expect(await anonymizeExpiredRegistrations(prisma, afterCutoff, (report) => reports.push(report))).toBe(0);
    expect(reports).toEqual([{ eventId: event.id, deliveries: [{ id: delivery.id, attempts: 2, status: 'SENDING' }] }]);
    expect(await reconcileStaleDeliveries(prisma, new Date(+afterCutoff + 20 * 60_000))).toBe(1);
    reports.length = 0;
    const muchLater = new Date('2030-01-01T00:00:00Z');
    expect(await anonymizeExpiredRegistrations(prisma, muchLater, (report) => reports.push(report))).toBe(0);
    expect(reports).toEqual([{ eventId: event.id, deliveries: [{ id: delivery.id, attempts: 2, status: 'AMBIGUOUS' }] }]);
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ error: INTERRUPTED_SEND, to: 'anne@example.com' });
  });

  it('makes the retention CLI exit nonzero with identifiers, expected attempt and recovery instructions', async () => {
    const { event, delivery } = await abandonedClaim();
    const result = runScript('retention');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(event.id);
    expect(result.stderr).toContain(delivery.id);
    expect(result.stderr).toContain('--expected-attempt 2');
    expect(result.stderr).toContain('mail:reconcile');
    expect(result.stderr).toContain('stopped');
    expect(result.stderr).not.toContain('anne@example.com');
  });

  it('rejects missing acknowledgement in the CLI and service without modifying the claim', async () => {
    const { delivery } = await abandonedClaim();
    const result = runScript('reconcile-delivery', ['--delivery-id', delivery.id, '--expected-attempt', '2', '--outcome', 'unknown']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--acknowledge-worker-stopped');
    await expect(resolveStoppedDelivery(prisma, { ...resolution(delivery.id), acknowledgeWorkerStopped: false }, afterCutoff)).rejects.toThrow('stopped');
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toEqual(delivery);
  });

  it.each([
    ['--delivery-id', 'id', '--expected-attempt', '2'],
    ['--delivery-id', 'id', '--expected-attempt', '2', '--outcome', 'failed'],
    ['--expected-attempt', '2', '--outcome', 'unknown'],
    ['--delivery-id', 'id', '--outcome', 'unknown'],
    ['--delivery-id', 'id', '--expected-attempt', '1.5', '--outcome', 'unknown'],
    ['--delivery-id', 'id', '--expected-attempt', '0', '--outcome', 'unknown'],
    ['--delivery-id', 'id', '--expected-attempt', '2', '--outcome', 'unknown', '--unexpected'],
  ])('rejects malformed CLI input %j', async (...args) => {
    const result = runScript('reconcile-delivery', [...args, '--acknowledge-worker-stopped']);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('claim changed');
    expect(result.stdout).not.toContain('resolved');
  });

  it.each(['unknown', 'verified-sent'] as const)('accepts valid CLI acknowledgement for %s, then retention exits zero', async (outcome) => {
    const { delivery } = await abandonedClaim();
    const resolved = runScript('reconcile-delivery', ['--delivery-id', delivery.id, '--expected-attempt', '2', '--outcome', outcome, '--acknowledge-worker-stopped']);
    expect(resolved.error).toBeUndefined();
    expect(resolved.status).toBe(0);
    expect(resolved.stdout).toContain(`delivery ${delivery.id}, attempt 2 as ${outcome === 'unknown' ? 'AMBIGUOUS' : 'SENT'}`);
    expect(resolved.stdout).toContain('no email was sent');
    expect(resolved.stdout).not.toContain('anne@example.com');
    const cleanup = runScript('retention');
    expect(cleanup.status).toBe(0);
    expect(cleanup.stdout).toContain('anonymised 1 registrations');
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: 'ANONYMIZED', to: '', messagePayload: null });
  });

  it.each([1, 3])('rejects wrong expected attempt %s', async (expectedAttempt) => {
    const { delivery } = await abandonedClaim();
    await expect(resolveStoppedDelivery(prisma, { ...resolution(delivery.id), expectedAttempt }, afterCutoff)).rejects.toThrow('claim changed');
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toEqual(delivery);
  });

  it.each(['PENDING', 'FAILED', 'SENT', 'AMBIGUOUS', 'ANONYMIZED'] as const)('rejects a non-claim %s row', async (status) => {
    const { delivery } = await abandonedClaim();
    const original = await prisma.emailLog.update({ where: { id: delivery.id }, data: { status, error: null } });
    await expect(resolveStoppedDelivery(prisma, resolution(delivery.id), afterCutoff)).rejects.toThrow('claim changed');
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toEqual(original);
  });

  it('allows only one of two operators to resolve the same claim', async () => {
    const { delivery } = await abandonedClaim();
    const results = await Promise.allSettled(['unknown', 'verified-sent'].map((outcome) =>
      resolveStoppedDelivery(prisma, resolution(delivery.id, outcome as 'unknown' | 'verified-sent'), afterCutoff)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it.each(['unknown', 'verified-sent'] as const)('resolves an acknowledged stopped worker as %s and permits cleanup', async (outcome) => {
    const { registration, delivery } = await abandonedClaim();
    await reconcileStaleDeliveries(prisma, new Date(+afterCutoff + 20 * 60_000));
    const resolved = await resolveStoppedDelivery(prisma, resolution(delivery.id, outcome), afterCutoff);
    expect(resolved).toMatchObject({ deliveryId: delivery.id, attempt: 2, status: outcome === 'unknown' ? 'AMBIGUOUS' : 'SENT' });
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      attempts: 2, lastAttemptAt: beforeCutoff, error: outcome === 'unknown' ? 'delivery_outcome_unknown' : null,
    });
    await expect(resolveStoppedDelivery(prisma, resolution(delivery.id, outcome), afterCutoff)).rejects.toThrow('claim changed');
    expect(await anonymizeExpiredRegistrations(prisma, afterCutoff)).toBe(1);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ parentEmail: '', anonymizedAt: afterCutoff });
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: 'ANONYMIZED', to: '', body: '', messagePayload: null });
  });

  it('does not automatically resend an unknown outcome, but permits a deliberate ambiguous retry', async () => {
    const { event, delivery } = await abandonedClaim();
    await resolveStoppedDelivery(prisma, resolution(delivery.id), beforeCutoff);
    const mailer = createDevMailer([]);
    await retryFailedDeliveries({ prisma, mailer }, event.id, delivery.batchId, [delivery.id], beforeCutoff);
    expect(mailer.sent).toHaveLength(0);
    await retryFailedDeliveries({ prisma, mailer }, event.id, delivery.batchId, [delivery.id], beforeCutoff, { includeAmbiguous: true });
    expect(mailer.sent).toHaveLength(1);
    await expect(resolveStoppedDelivery(prisma, resolution(delivery.id), beforeCutoff)).rejects.toThrow('claim changed');
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: 'SENT', attempts: 3 });
  });

  it.each(['completed', 'new-attempt'] as const)('compare-and-set refuses a claim that is %s after it was read', async (change) => {
    const { delivery } = await abandonedClaim();
    const racing = prisma.$extends({ query: { emailLog: { async updateMany({ args, query }) {
      await prisma.emailLog.update({ where: { id: delivery.id }, data: change === 'completed'
        ? { status: 'SENT', sentAt: beforeCutoff }
        : { attempts: 3, lastAttemptAt: afterCutoff } });
      return query(args);
    } } } });
    await expect(resolveStoppedDelivery(racing as typeof prisma, resolution(delivery.id), afterCutoff)).rejects.toThrow('claim changed');
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject(change === 'completed'
      ? { status: 'SENT', sentAt: beforeCutoff }
      : { status: 'SENDING', attempts: 3, lastAttemptAt: afterCutoff });
  });

  it.each([
    ['unknown', false, false], ['unknown', true, false], ['verified-sent', false, false], ['verified-sent', true, false],
    ['unknown', false, true], ['unknown', true, true], ['verified-sent', false, true], ['verified-sent', true, true],
  ] as const)('fences late completion: outcome=%s, provider rejects=%s, cleaned=%s', async (outcome, rejects, cleanup) => {
    const { event } = await setup();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const mailer = { send: vi.fn(async () => { enter(); await blocked; if (rejects) throw new Error('late provider failure'); }) };
    const sending = sendEventMessage({ prisma, mailer }, event.id, content, beforeCutoff, { batchId: 'late-worker' });
    await entered;
    try {
      const row = await prisma.emailLog.findFirstOrThrow();
      await resolveStoppedDelivery(prisma, { ...resolution(row.id, outcome), expectedAttempt: 1 }, afterCutoff);
      if (cleanup) expect(await anonymizeExpiredRegistrations(prisma, afterCutoff)).toBe(1);
      const resolved = await prisma.emailLog.findUniqueOrThrow({ where: { id: row.id } });
      release();
      await sending;
      expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(resolved);
      if (cleanup) expect(resolved).toMatchObject({ status: 'ANONYMIZED', to: '', subject: '', body: '', messagePayload: null });
    } finally {
      release();
      await sending;
    }
  });
});
