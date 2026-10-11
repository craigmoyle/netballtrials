import { describe, expect, it } from 'vitest';
import { e2eBindHost } from '../../scripts/e2e-runtime';

describe('E2E listener binding', () => {
  it('defaults to loopback for host-run test servers', () => {
    expect(e2eBindHost({} as NodeJS.ProcessEnv)).toBe('127.0.0.1');
  });

  it('uses an explicit container listener address when configured', () => {
    expect(e2eBindHost({ E2E_BIND_HOST: '0.0.0.0' } as NodeJS.ProcessEnv)).toBe('0.0.0.0');
  });
});
