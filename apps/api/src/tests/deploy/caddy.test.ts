import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const caddyfile = readFileSync(new URL('../../../../../deploy/vps/Caddyfile', import.meta.url), 'utf8');

describe('Caddy permissions policy', () => {
  it('allows the Trials scanner camera without enabling it for Stats', () => {
    const [statsBlock, trialsBlock] = caddyfile.split('{$TRIALS_DOMAIN}');

    expect(statsBlock).toContain('Permissions-Policy "camera=(), microphone=(), geolocation=()"');
    expect(trialsBlock).toContain('Permissions-Policy "camera=(self), microphone=(), geolocation=()"');
  });
});
