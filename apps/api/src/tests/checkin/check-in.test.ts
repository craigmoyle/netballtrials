import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { hashPin } from '../../checkin/pin';
import { closeCheckIn, manualCheckIn, setCheckInPin } from '../../checkin/service';
import { withdrawRegistration } from '../../registrations/service';
import { ensureReviewItems, resolveReviewItem, listReviewQueue } from '../../review/service';

let app: ReturnType<typeof createApp>;
let cookie: string;
let eventId: string;

const header = { 'x-test-now': '2026-09-12T00:00:00.000Z' };

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), checkInPinHash: await hashPin('482193') } });
  eventId = event.id;
  app = createApp();
  const opened = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '482193' }, headers: header });
  cookie = opened.cookies.find((c) => c.name === 'nt_checkin')!.value;
});

async function paid(token: string, overrides: Record<string, unknown> = {}) {
  return prisma.registration.create({ data: { ...registrationFixture(eventId), status: 'PAID', qrToken: token, ...overrides } });
}

describe('check-in', () => {
  it('checks a paid player in and assigns the next bib', async () => {
    await paid('t'.repeat(43));
    const res = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 't'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json().result).toBe('checked_in');
    expect(res.json().registrationId).toBeTruthy();
    expect(res.json().bibNumber).toBe(1);
  });
  it('does not allocate bib gaps for simultaneous duplicate scans', async () => {
    const registration = await paid('c'.repeat(43));
    const responses = await Promise.all([1, 2].map(() => app.inject({
      method: 'POST', url: '/api/check-in/scan', payload: { token: 'c'.repeat(43) },
      cookies: { nt_checkin: cookie }, headers: header,
    })));
    expect(responses.map((response) => response.json().result).sort()).toEqual(['already', 'checked_in']);
    expect(responses.map((response) => response.json().bibNumber)).toEqual([1, 1]);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).bibNumber).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).nextBibNumber).toBe(2);
  });

  it('rechecks paid status inside the attendance transaction after withdrawal', async () => {
    const registration = await paid('r'.repeat(43));
    const racingPrisma = {
      event: prisma.event,
      $transaction: prisma.$transaction.bind(prisma),
      registration: {
        findFirst: async (args: any) => {
          const stale = await prisma.registration.findFirst(args);
          await withdrawRegistration(prisma, eventId, registration.id, new Date());
          return stale;
        },
        findUnique: prisma.registration.findUnique.bind(prisma.registration),
        updateMany: prisma.registration.updateMany.bind(prisma.registration),
      },
    };
    const result = await manualCheckIn(racingPrisma as any, eventId, registration.id, 'Volunteer', new Date('2026-09-12T00:00:00.000Z'), cookie);
    expect(result?.result).toBe('refused');
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('WITHDRAWN');
    expect(after.checkedInAt).toBeNull();
    expect(after.bibNumber).toBeNull();
  });

  it('does not check in a registration concurrently withdrawn by staff', async () => {
    const registration = await paid('w'.repeat(43));
    await Promise.all([
      app.inject({ method: 'POST', url: `/api/check-in/registrations/${registration.id}`, cookies: { nt_checkin: cookie }, headers: header }),
      withdrawRegistration(prisma, eventId, registration.id, new Date()),
    ]);
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('WITHDRAWN');
    expect(after.checkedInAt).toBeNull();
    expect(after.bibNumber).toBeNull();
  });

  it('revokes existing sessions when the event PIN is cleared or rotated', async () => {
    await setCheckInPin(prisma, eventId, null, new Date());
    const response = await app.inject({ method: 'GET', url: '/api/check-in/session', cookies: { nt_checkin: cookie }, headers: header });
    expect(response.statusCode).toBe(401);
  });

  it('revokes existing sessions when check-in is closed', async () => {
    await closeCheckIn(prisma, eventId, new Date());
    const response = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 'x'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(response.statusCode).toBe(401);
  });

  it('refers to committee only while the age review remains unresolved', async () => {
    const registration = await paid('f'.repeat(43), { ageFlagged: true });
    await ensureReviewItems(prisma, eventId);
    expect((await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 'f'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header })).json().referToCommittee).toBe(true);
    const item = (await listReviewQueue(prisma, eventId))[0];
    await resolveReviewItem(prisma, eventId, item.id, { resolvedByUserId: 'admin', note: 'Reviewed' }, new Date());
    await prisma.registration.update({ where: { id: registration.id }, data: { checkedInAt: null, bibNumber: null, checkedInBy: null } });
    const response = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 'f'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(response.json().referToCommittee).toBe(false);
  });

  it('does not refer a withdrawn flagged registration and removes it from the open queue', async () => {
    const registration = await paid('d'.repeat(43), { ageFlagged: true });
    await ensureReviewItems(prisma, eventId);
    expect(await listReviewQueue(prisma, eventId)).toHaveLength(1);
    await withdrawRegistration(prisma, eventId, registration.id, new Date());
    const result = await manualCheckIn(prisma, eventId, registration.id, 'Volunteer', new Date('2026-09-12T00:00:00Z'), cookie);
    expect(result).toMatchObject({ result: 'refused', reason: 'not_paid', referToCommittee: false });
    expect(await listReviewQueue(prisma, eventId)).toHaveLength(0);
  });

  it('is idempotent for a second scan', async () => {
    await paid('t'.repeat(43));
    await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 't'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    const again = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 't'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(again.json().result).toBe('already');
    expect(again.json().bibNumber).toBe(1);
  });
  it('refuses an unpaid registration', async () => {
    await prisma.registration.create({ data: { ...registrationFixture(eventId), status: 'PENDING', qrToken: 'p'.repeat(43) } });
    const res = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 'p'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json()).toMatchObject({ result: 'refused', reason: 'not_paid' });
  });
  it('refuses an unknown token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 'z'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json()).toMatchObject({ result: 'refused', reason: 'unknown' });
  });
  it('marks a review-flagged registration without leaking detail', async () => {
    await paid('t'.repeat(43), { ageFlagged: true });
    const res = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 't'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json().referToCommittee).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain('age');
  });
  it('finds a paid registration by partial, differently cased name', async () => {
    await paid('t'.repeat(43));
    const res = await app.inject({ method: 'GET', url: '/api/check-in/lookup?q=LOVE', cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].playerName).toBe('Ada Lovelace');
  });
  it('undoes a check-in', async () => {
    const reg = await paid('t'.repeat(43));
    await app.inject({ method: 'POST', url: `/api/check-in/registrations/${reg.id}`, cookies: { nt_checkin: cookie }, headers: header });
    const undo = await app.inject({ method: 'POST', url: `/api/check-in/registrations/${reg.id}/undo`, cookies: { nt_checkin: cookie }, headers: header });
    expect(undo.statusCode).toBe(204);
    expect((await prisma.registration.findUnique({ where: { id: reg.id } }))?.checkedInAt).toBeNull();
  });
  it('keeps the same bib number when a check-in is undone and redone', async () => {
    const first = await paid('a'.repeat(43));
    const second = await paid('b'.repeat(43), { playerFirstName: 'Bea', playerNameNormalized: 'bea lovelace' });
    const checkIn = (id: string) => app.inject({ method: 'POST', url: `/api/check-in/registrations/${id}`, cookies: { nt_checkin: cookie }, headers: header });
    expect((await checkIn(first.id)).json().bibNumber).toBe(1);
    expect((await checkIn(second.id)).json().bibNumber).toBe(2);
    const undo = await app.inject({ method: 'POST', url: `/api/check-in/registrations/${first.id}/undo`, cookies: { nt_checkin: cookie }, headers: header });
    expect(undo.statusCode).toBe(204);
    const undone = await prisma.registration.findUniqueOrThrow({ where: { id: first.id } });
    expect(undone).toMatchObject({ checkedInAt: null, checkedInBy: null, bibNumber: 1 });
    const lookup = await app.inject({ method: 'GET', url: '/api/check-in/lookup?q=ada', cookies: { nt_checkin: cookie }, headers: header });
    expect(lookup.json().find((row: { id: string }) => row.id === first.id)).toMatchObject({ checkedIn: false, bibNumber: null });

    const redo = await checkIn(first.id);
    expect(redo.json()).toMatchObject({ result: 'checked_in', bibNumber: 1 });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).nextBibNumber).toBe(3);
    expect((await checkIn((await paid('c'.repeat(43), { playerFirstName: 'Cy', playerNameNormalized: 'cy lovelace' })).id)).json().bibNumber).toBe(3);
  });
  it('caps the volunteer label at 40 trimmed characters', async () => {
    const reg = await paid('l'.repeat(43));
    await app.inject({
      method: 'POST', url: `/api/check-in/registrations/${reg.id}`, cookies: { nt_checkin: cookie },
      headers: { ...header, 'x-checkin-label': `   ${'V'.repeat(100)}   ` },
    });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).checkedInBy).toBe('V'.repeat(40));
    const blank = await paid('m'.repeat(43), { playerFirstName: 'Bea', playerNameNormalized: 'bea lovelace' });
    await app.inject({
      method: 'POST', url: `/api/check-in/registrations/${blank.id}`, cookies: { nt_checkin: cookie },
      headers: { ...header, 'x-checkin-label': '    ' },
    });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: blank.id } })).checkedInBy).toBe('Volunteer');
  });
  it('requires a check-in session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/check-in/lookup?q=a' });
    expect(res.statusCode).toBe(401);
  });
});
