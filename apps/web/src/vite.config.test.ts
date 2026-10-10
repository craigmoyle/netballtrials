import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

describe('Vite API development proxy', () => {
  it('proxies same-origin /api requests to the configured API target', () => {
    expect(viteConfig.server?.proxy).toMatchObject({
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    });
  });
});
