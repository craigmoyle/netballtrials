export type StripeIntegrationCredentials = { secretKey: string; webhookSecret: string };
export type GmailIntegrationCredentials = { clientId: string; clientSecret: string; refreshToken: string };
export type IntegrationCredentials = {
  stripe: StripeIntegrationCredentials | null;
  gmail: GmailIntegrationCredentials | null;
};
export type IntegrationCredentialStatus = {
  stripe: { configured: boolean; updatedAt: string | null };
  gmail: { configured: boolean; updatedAt: string | null };
};

export type InfisicalConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: string;
  secretPath: string;
};

type InfisicalSecret = { secretValue?: unknown; updatedAt?: unknown };
type InfisicalSecretResponse = { secret?: InfisicalSecret };
type IntegrationRecord = { value: string; updatedAt: string | null } | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStripe(value: string | null): StripeIntegrationCredentials | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.secretKey !== 'string' || typeof parsed.webhookSecret !== 'string' ||
        !parsed.secretKey.trim() || !parsed.webhookSecret.trim()) return null;
    return { secretKey: parsed.secretKey, webhookSecret: parsed.webhookSecret };
  } catch {
    return null;
  }
}

function parseGmail(value: string | null): GmailIntegrationCredentials | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.clientId !== 'string' || typeof parsed.clientSecret !== 'string' ||
        typeof parsed.refreshToken !== 'string' || !parsed.clientId.trim() || !parsed.clientSecret.trim() || !parsed.refreshToken.trim()) return null;
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}

/** A narrow Infisical Cloud adapter. Secret values never leave this server-side module. */
export class InfisicalSecretStore {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenRequest: Promise<string> | null = null;
  private readonly baseUrl: string;

  constructor(
    private readonly config: InfisicalConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}/api/v1/auth/universal-auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId: this.config.clientId, clientSecret: this.config.clientSecret }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new Error('Could not connect to the secret manager.');
      }
      if (!response.ok) throw new Error('Secret manager authentication failed.');
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('Secret manager returned an invalid response.'); }
      if (!isRecord(payload) || typeof payload.accessToken !== 'string' || typeof payload.expiresIn !== 'number') {
        throw new Error('Secret manager returned an invalid authentication response.');
      }
      this.accessToken = payload.accessToken;
      this.tokenExpiresAt = Date.now() + payload.expiresIn * 1000;
      return this.accessToken;
    })().finally(() => { this.tokenRequest = null; });
    return this.tokenRequest;
  }

  private secretUrl(name: string): string {
    const query = new URLSearchParams({
      projectId: this.config.projectId,
      environment: this.config.environment,
      secretPath: this.config.secretPath || '/',
      viewSecretValue: 'true',
    });
    return `${this.baseUrl}/api/v4/secrets/${encodeURIComponent(name)}?${query}`;
  }

  private async requestSecret(name: string): Promise<IntegrationRecord> {
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await this.fetcher(this.secretUrl(name), {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Could not read integration credentials from the secret manager.');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Could not read integration credentials from the secret manager.');
    let payload: InfisicalSecretResponse;
    try { payload = await response.json() as InfisicalSecretResponse; } catch {
      throw new Error('Secret manager returned an invalid secret response.');
    }
    const secret = payload.secret;
    if (!secret || typeof secret.secretValue !== 'string') return null;
    return {
      value: secret.secretValue,
      updatedAt: typeof secret.updatedAt === 'string' ? secret.updatedAt : null,
    };
  }

  private async writeSecret(name: string, value: string): Promise<void> {
    const token = await this.getAccessToken();
    const existing = await this.requestSecret(name);
    const method = existing ? 'PATCH' : 'POST';
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/api/v4/secrets/${encodeURIComponent(name)}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: this.config.projectId,
          environment: this.config.environment,
          secretPath: this.config.secretPath || '/',
          secretValue: value,
          type: 'shared',
          secretComment: 'Managed by Netball Trials integration settings',
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Could not update integration credentials in the secret manager.');
    }
    if (!response.ok) throw new Error('Could not update integration credentials in the secret manager.');
    this.accessToken = token;
  }

  async readCredentials(): Promise<IntegrationCredentials> {
    const [stripe, gmail] = await Promise.all([
      this.requestSecret('STRIPE_INTEGRATION'),
      this.requestSecret('GMAIL_INTEGRATION'),
    ]);
    return { stripe: parseStripe(stripe?.value ?? null), gmail: parseGmail(gmail?.value ?? null) };
  }

  async getStatus(): Promise<IntegrationCredentialStatus> {
    const [stripe, gmail] = await Promise.all([
      this.requestSecret('STRIPE_INTEGRATION'),
      this.requestSecret('GMAIL_INTEGRATION'),
    ]);
    return {
      stripe: { configured: parseStripe(stripe?.value ?? null) !== null, updatedAt: stripe?.updatedAt ?? null },
      gmail: { configured: parseGmail(gmail?.value ?? null) !== null, updatedAt: gmail?.updatedAt ?? null },
    };
  }

  async replaceStripe(credentials: StripeIntegrationCredentials): Promise<void> {
    await this.writeSecret('STRIPE_INTEGRATION', JSON.stringify(credentials));
  }

  async replaceGmail(credentials: GmailIntegrationCredentials): Promise<void> {
    await this.writeSecret('GMAIL_INTEGRATION', JSON.stringify(credentials));
  }
}
