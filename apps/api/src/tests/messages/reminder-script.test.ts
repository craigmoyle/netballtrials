import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiDirectory = resolve(import.meta.dirname, '../../..');
const testDatabase = 'postgresql://postgres:postgres@localhost:5432/netballtrials_test';

describe('send-reminders command safeguards', () => {
  it('refuses production without Gmail OAuth credentials', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/scripts/send-reminders.ts'], {
      cwd: apiDirectory,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_not_used',
        STRIPE_WEBHOOK_SECRET: 'whsec_not_used',
        SESSION_COOKIE_SECURE: 'true',
        WEB_ORIGIN: 'https://trials.example',
        API_PUBLIC_URL: 'https://api.example',
        MAIL_FROM: 'chisholmnetball@gmail.com',
        MAIL_REPLY_TO: 'chisholmnetball@gmail.com',
        GMAIL_CLIENT_ID: '',
        GMAIL_CLIENT_SECRET: '',
        GMAIL_REFRESH_TOKEN: '',
        DATABASE_URL: testDatabase,
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/GMAIL/i);
  });

  it('requires dry-run for non-production job runs', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/scripts/send-reminders.ts'], {
      cwd: apiDirectory,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PAYMENT_PROVIDER: 'fake',
        SESSION_COOKIE_SECURE: 'false',
        WEB_ORIGIN: 'http://localhost:5173',
        API_PUBLIC_URL: 'http://localhost:3000',
        MAIL_FROM: 'chisholmnetball@gmail.com',
        MAIL_REPLY_TO: 'chisholmnetball@gmail.com',
        DATABASE_URL: testDatabase,
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--dry-run/);
  });
});
