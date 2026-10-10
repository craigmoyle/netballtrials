import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture } from '../helpers/fixtures';

const app = createApp();
let adminCookie: string;
let eventId: string;
const pdf = Buffer.from('%PDF-1.4\npolicy\n%%EOF');

beforeEach(async () => {
  await resetDb();
  adminCookie = await signInAsNewAdmin(app, 'admin@example.com');
  eventId = (await prisma.event.create({ data: eventFixture({ status: 'OPEN' }) })).id;
});

describe('event policy documents', () => {
  it('stores a bounded PDF and serves it with a safe public response', async () => {
    const upload = await app.inject({
      method: 'PUT',
      url: `/api/admin/events/${eventId}/policy-document`,
      payload: { fileName: 'Selection policy.pdf', pdfBase64: pdf.toString('base64') },
      cookies: { nt_session: adminCookie },
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json().policyDocumentName).toBe('Selection policy.pdf');

    const publicEvent = await app.inject({ method: 'GET', url: `/api/public/events/${eventId}` });
    expect(publicEvent.json().policyUrl).toBe(`http://localhost:3000/api/public/events/${eventId}/policy-document`);
    const document = await app.inject({ method: 'GET', url: `/api/public/events/${eventId}/policy-document` });
    expect(document.statusCode).toBe(200);
    expect(document.headers['content-type']).toContain('application/pdf');
    expect(document.headers['x-content-type-options']).toBe('nosniff');
    expect(document.body).toContain('%PDF-1.4');
  });

  it('rejects non-PDF content, unsafe names, and documents above the size limit', async () => {
    const badType = await app.inject({
      method: 'PUT',
      url: `/api/admin/events/${eventId}/policy-document`,
      payload: { fileName: 'policy.pdf', pdfBase64: Buffer.from('not a PDF').toString('base64') },
      cookies: { nt_session: adminCookie },
    });
    const unsafeName = await app.inject({
      method: 'PUT',
      url: `/api/admin/events/${eventId}/policy-document`,
      payload: { fileName: '../../policy.pdf', pdfBase64: pdf.toString('base64') },
      cookies: { nt_session: adminCookie },
    });
    const tooLarge = await app.inject({
      method: 'PUT',
      url: `/api/admin/events/${eventId}/policy-document`,
      payload: { fileName: 'large.pdf', pdfBase64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(700 * 1024)]).toString('base64') },
      cookies: { nt_session: adminCookie },
    });
    expect(badType.statusCode).toBe(400);
    expect(unsafeName.statusCode).toBe(400);
    expect(tooLarge.statusCode).toBe(413);
  });

  it('requires an admin session to upload a policy', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/events/${eventId}/policy-document`,
      payload: { fileName: 'policy.pdf', pdfBase64: pdf.toString('base64') },
    });
    expect(response.statusCode).toBe(401);
  });
});
