import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './src/tests/global-setup.ts',
    setupFiles: ['./src/tests/setup-env.ts'],
    // All API tests share one Postgres test database and reset it between
    // tests, so files must not run in parallel.
    fileParallelism: false,
  },
});
