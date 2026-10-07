import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // globalSetup: './src/tests/global-setup.ts', // enabled in Task 2
  },
});
