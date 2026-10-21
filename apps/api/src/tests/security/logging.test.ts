import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { loadEnv } from '../../env';
import { createFakePaymentProvider } from '../../payments/fake';

function capture() {
  const lines: Record<string, unknown>[] = [];
  return { lines, stream: { write: (line: string) => { lines.push(JSON.parse(line)); } } };
}

describe('request logging', () => {
  it('is disabled in tests', () => {
    const app = createApp({ env: loadEnv({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'fake' }), payment: createFakePaymentProvider() });
    expect(app.log.level ?? 'silent').toBe('silent');
  });

  it('logs only the method and route pattern, never tokens, query strings, headers or bodies', async () => {
    const { lines, stream } = capture();
    const app = createApp(
      { env: loadEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'fake' }), payment: createFakePaymentProvider() },
      { logStream: stream },
    );
    expect(app.log.level).toBe('info');
    app.get('/boom', async () => { throw new Error('failed for secret@example.com'); });
    await app.inject({
      method: 'GET',
      url: '/api/public/ticket/secret-ticket-token?session=cs_secret_session',
      headers: { cookie: 'nt_session=secret-cookie', authorization: 'Bearer secret-auth' },
    });
    await app.inject({ method: 'POST', url: '/no/such/secret-path-token', payload: { parentEmail: 'secret@example.com' } });
    await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      headers: { 'content-type': 'application/json' },
      payload: '{"token":"secret-login-token"',
    });
    await app.inject({ method: 'GET', url: '/boom' });
    await app.close();

    const output = lines.map((line) => JSON.stringify(line)).join('\n');
    expect(output).not.toMatch(/secret/);
    const incoming = lines.filter((line) => line.msg === 'incoming request');
    expect(incoming.map((line) => line.req)).toEqual([
      { method: 'GET', route: '/api/public/ticket/:token' },
      { method: 'POST' },
      { method: 'POST', route: '/api/auth/verify' },
      { method: 'GET', route: '/boom' },
    ]);
    expect(lines.find((line) => line.level === 50)).toMatchObject({ msg: 'request error', err: { type: 'Error' } });
  });
});
