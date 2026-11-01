import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { loadEnv } from '../../env';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';

const env = loadEnv({
  DATABASE_URL: 'postgresql://test:test@localhost:5432/netballtrials_test',
  NODE_ENV: 'production', APP_ENV: 'testing', PAYMENT_PROVIDER: 'fake', SESSION_COOKIE_SECURE: 'true',
  WEB_ORIGIN: 'https://test.example', API_PUBLIC_URL: 'https://api.test.example', ENABLE_TEST_INTEGRATIONS: 'false',
  TEST_ADMIN_EMAILS: 'cmoyle@gmail.com,nicole@example.test',
});

let app: ReturnType<typeof createApp> | undefined;

afterEach(async () => { await app?.close(); });

describe('hosted TEST access when provider integrations are disabled', () => {
  it('still requires an allowlisted Admin for fake checkout and other application APIs', async () => {
    await resetDb();
    app = createApp({ prisma, env }, { logStream: { write: () => undefined } });
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({ testAccessRequired: true, testIntegrationsEnabled: false });

    const checkout = await app.inject({ method: 'POST', url: '/api/public/fake-checkouts/complete', payload: { simulationToken: 'guessable' } });
    expect(checkout.statusCode).toBe(401);

    const publicData = await app.inject({ method: 'GET', url: '/api/public/events' });
    expect(publicData.statusCode).toBe(401);
  });
});
