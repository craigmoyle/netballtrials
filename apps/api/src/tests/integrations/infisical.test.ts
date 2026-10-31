import { describe, expect, it, vi } from 'vitest';
import { InfisicalSecretStore, type InfisicalConfig } from '../../integrations/infisical';

const config: InfisicalConfig = {
  baseUrl: 'https://us.infisical.com/', clientId: 'machine-id', clientSecret: 'machine-secret',
  projectId: 'project-id', environment: 'test', secretPath: '/netball-trials',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function authResponse() {
  return jsonResponse({ accessToken: 'access-token', expiresIn: 3600, accessTokenMaxTTL: 3600, tokenType: 'Bearer' });
}

describe('InfisicalSecretStore', () => {
  it('reads only server-side integration secrets and exposes configuration metadata, not values', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(jsonResponse({ secret: { secretValue: JSON.stringify({ secretKey: 'sk_test_123', webhookSecret: 'whsec_123' }), updatedAt: '2026-10-31T00:00:00Z' } }))
      .mockResolvedValueOnce(jsonResponse({ secret: { secretValue: JSON.stringify({ clientId: 'gmail-id', clientSecret: 'gmail-secret', refreshToken: 'refresh-token' }), updatedAt: '2026-10-30T00:00:00Z' } }))
      .mockResolvedValueOnce(jsonResponse({ secret: { secretValue: JSON.stringify({ secretKey: 'sk_test_123', webhookSecret: 'whsec_123' }), updatedAt: '2026-10-31T00:00:00Z' } }))
      .mockResolvedValueOnce(jsonResponse({ secret: { secretValue: JSON.stringify({ clientId: 'gmail-id', clientSecret: 'gmail-secret', refreshToken: 'refresh-token' }), updatedAt: '2026-10-30T00:00:00Z' } }));
    const store = new InfisicalSecretStore(config, fetcher as typeof fetch);

    const credentials = await store.readCredentials();
    const status = await store.getStatus();

    expect(credentials).toEqual({
      stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_123' },
      gmail: { clientId: 'gmail-id', clientSecret: 'gmail-secret', refreshToken: 'refresh-token' },
    });
    expect(status).toEqual({
      stripe: { configured: true, updatedAt: '2026-10-31T00:00:00Z' },
      gmail: { configured: true, updatedAt: '2026-10-30T00:00:00Z' },
    });
    expect(JSON.stringify(status)).not.toContain('secret');
    expect(fetcher.mock.calls[0][0]).toBe('https://us.infisical.com/api/v1/auth/universal-auth/login');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('creates missing secrets and updates existing secrets without returning their contents', async () => {
    const newSecretFetcher = vi.fn()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ secret: { id: 'secret-id' } }));
    const createStore = new InfisicalSecretStore(config, newSecretFetcher as typeof fetch);
    await createStore.replaceStripe({ secretKey: 'sk_test_new', webhookSecret: 'whsec_new' });
    expect(newSecretFetcher.mock.calls[2][1]).toMatchObject({ method: 'POST' });

    const updateFetcher = vi.fn()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(jsonResponse({ secret: { secretValue: '{"secretKey":"old","webhookSecret":"old"}' } }))
      .mockResolvedValueOnce(jsonResponse({ secret: { id: 'secret-id' } }));
    const updateStore = new InfisicalSecretStore(config, updateFetcher as typeof fetch);
    await updateStore.replaceStripe({ secretKey: 'sk_test_new', webhookSecret: 'whsec_new' });

    const updateCall = updateFetcher.mock.calls[2];
    expect(updateCall[1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(updateCall[1]?.body))).toMatchObject({
      projectId: 'project-id', environment: 'test', secretPath: '/netball-trials', type: 'shared',
      secretValue: JSON.stringify({ secretKey: 'sk_test_new', webhookSecret: 'whsec_new' }),
    });
  });

  it('fails with sanitized errors when Infisical authentication fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'machine-secret leaked by upstream' }, 401));
    const store = new InfisicalSecretStore(config, fetcher as typeof fetch);

    await expect(store.readCredentials()).rejects.toThrow('Secret manager authentication failed.');
  });
});
