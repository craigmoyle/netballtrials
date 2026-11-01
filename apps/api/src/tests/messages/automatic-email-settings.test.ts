import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { DEFAULT_AUTOMATIC_EMAIL_SETTINGS, renderAutomaticEmailSubject } from '../../messages/automatic-email-settings';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
});

describe('automatic email settings', () => {
  it('keeps newlines from dynamic values out of the subject line', () => {
    expect(renderAutomaticEmailSubject('Welcome {{playerName}}', { playerName: 'Player\nName' })).toBe('Welcome Player Name');
  });

  it('requires an Admin and returns safe default templates before they are customized', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings/automatic-email' })).statusCode).toBe(401);
    const response = await app.inject({ method: 'GET', url: '/api/admin/settings/automatic-email', cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ...DEFAULT_AUTOMATIC_EMAIL_SETTINGS, updatedAt: null });
  });

  it('saves validated templates and a reminder lead time', async () => {
    const input = {
      ...DEFAULT_AUTOMATIC_EMAIL_SETTINGS,
      confirmationSubject: 'Welcome {{playerName}} — {{eventName}}',
      reminderLeadHours: 48,
    };
    const response = await app.inject({ method: 'PUT', url: '/api/admin/settings/automatic-email', cookies: { nt_session: cookie }, payload: input });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ...input, updatedAt: expect.any(String) });
    expect(await prisma.automaticEmailSettings.findUnique({ where: { id: 'automatic' } })).toMatchObject({ reminderLeadHours: 48 });
  });

  it('rejects unknown or missing template fields and invalid lead times', async () => {
    const input = { ...DEFAULT_AUTOMATIC_EMAIL_SETTINGS, confirmationBody: '{{playerName}} {{unknownField}}' };
    const invalidTemplate = await app.inject({ method: 'PUT', url: '/api/admin/settings/automatic-email', cookies: { nt_session: cookie }, payload: input });
    expect(invalidTemplate.statusCode).toBe(400);
    expect(invalidTemplate.json()).toMatchObject({ error: 'invalid_email_template', fields: ['confirmationBody'] });

    const missingRequired = await app.inject({ method: 'PUT', url: '/api/admin/settings/automatic-email', cookies: { nt_session: cookie }, payload: { ...DEFAULT_AUTOMATIC_EMAIL_SETTINGS, reminderBody: '{{eventName}}' } });
    expect(missingRequired.statusCode).toBe(400);
    expect(missingRequired.json().fields).toContain('reminderBody');

    const invalidHours = await app.inject({ method: 'PUT', url: '/api/admin/settings/automatic-email', cookies: { nt_session: cookie }, payload: { ...DEFAULT_AUTOMATIC_EMAIL_SETTINGS, reminderLeadHours: 169 } });
    expect(invalidHours.statusCode).toBe(400);
    expect(await prisma.automaticEmailSettings.findUnique({ where: { id: 'automatic' } })).toBeNull();
  });
});
