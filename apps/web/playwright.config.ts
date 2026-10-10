import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const webOrigin = 'http://127.0.0.1:5173';
const apiOrigin = 'http://127.0.0.1:3000';
const controlOrigin = 'http://127.0.0.1:3001';
const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/netballtrials_test';
if (!databaseUrl.endsWith('_test')) throw new Error('E2E tests require a DATABASE_URL ending in _test');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: '../../test-results/e2e',
  use: {
    baseURL: webOrigin,
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: [
    {
      command: 'npm run e2e:server --workspace @netball-trials/api',
      cwd: repoRoot,
      url: `${controlOrigin}/__test/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PAYMENT_PROVIDER: 'fake',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: webOrigin,
        API_PUBLIC_URL: apiOrigin,
        SESSION_COOKIE_SECURE: 'false',
        PORT: '3000',
        E2E_CONTROL_PORT: '3001',
      },
    },
    {
      command: 'npm run dev --workspace @netball-trials/web -- --host 127.0.0.1',
      cwd: repoRoot,
      url: `${webOrigin}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...process.env, VITE_API_URL: apiOrigin },
    },
  ],
});
