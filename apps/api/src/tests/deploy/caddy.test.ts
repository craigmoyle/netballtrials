import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const caddyfile = readFileSync(new URL('../../../../../deploy/vps/Caddyfile.web', import.meta.url), 'utf8');

describe('Trials web Caddy config', () => {
  it('allows the Trials scanner camera', () => {
    expect(caddyfile).toContain('Permissions-Policy "camera=(self), microphone=(), geolocation=()"');
  });

  it('trusts only the exact edge IP when deriving client IPs', () => {
    expect(caddyfile).toContain('trusted_proxies static 172.30.50.2');
    expect(caddyfile).not.toContain('172.30.50.0/24');
    expect(caddyfile).toContain('header_up X-Forwarded-For {client_ip}');
  });

  it('exposes a web-only health endpoint', () => {
    expect(caddyfile).toContain('path /web-health');
    expect(caddyfile).toContain('respond "ok" 200');
  });
});
