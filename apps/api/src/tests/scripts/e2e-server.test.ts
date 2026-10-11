import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('E2E server database guard', () => {
  it('refuses a non-test database before opening listeners or migrating', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/scripts/e2e-server.ts'],
      {
        cwd: resolve(import.meta.dirname, '../../..'),
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PAYMENT_PROVIDER: 'fake',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/netballtrials_dev',
          WEB_ORIGIN: 'http://localhost:5173',
          API_PUBLIC_URL: 'http://localhost:3000',
          SESSION_COOKIE_SECURE: 'false',
          E2E_BIND_HOST: '127.0.0.1',
          PORT: '3300',
          E2E_CONTROL_PORT: '3301',
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/DATABASE_URL ending in _test/);
    expect(result.stderr).not.toMatch(/P1001|migrate deploy/i);
  });
});
