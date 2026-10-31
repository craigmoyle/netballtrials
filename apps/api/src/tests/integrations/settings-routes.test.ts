import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { signInAsNewAdmin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'integration-settings-admin@example.test');
});

afterAll(async () => { await app.close(); });

describe('integration settings routes', () => {
  it('reports fake integrations in the local test environment without exposing credential fields', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/settings/integrations', cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'fake',
      stripe: { configured: false, updatedAt: null },
      gmail: { configured: false, updatedAt: null },
    });
    expect(response.body).not.toContain('secret');
  });

  it('does not allow live integration credentials to be stored from the fake test environment', async () => {
    const response = await app.inject({
      method: 'PUT', url: '/api/admin/settings/integrations/stripe', cookies: { nt_session: cookie },
      payload: { secretKey: 'sk_test_not-a-real-key', webhookSecret: 'whsec_not-a-real-secret' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'secret_store_not_configured' });
    expect(response.body).not.toContain('not-a-real');
  });
});
