import type { Env } from '../env';
import {
  InfisicalSecretStore,
  type GmailIntegrationCredentials,
  type IntegrationCredentialStatus,
  type IntegrationCredentials,
  type StripeIntegrationCredentials,
} from './infisical';

export type IntegrationMode = 'fake' | 'environment' | 'infisical';
export type IntegrationStatus = IntegrationCredentialStatus & { mode: IntegrationMode };

export class IntegrationSettingsUnavailableError extends Error {
  constructor() {
    super('Integration credentials can only be replaced through the configured secret manager.');
    this.name = 'IntegrationSettingsUnavailableError';
  }
}

export class IntegrationSettings {
  readonly mode: IntegrationMode;
  private readonly store: InfisicalSecretStore | null;

  constructor(private readonly env: Env, fetcher: typeof fetch = fetch) {
    const configured = env.NODE_ENV !== 'test' && Boolean(
      env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID && env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET &&
      env.INFISICAL_PROJECT_ID && env.INFISICAL_ENVIRONMENT,
    );
    this.mode = configured ? 'infisical' : env.NODE_ENV === 'production' ? 'environment' : 'fake';
    this.store = configured ? new InfisicalSecretStore({
      baseUrl: env.INFISICAL_API_URL,
      clientId: env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID,
      clientSecret: env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET,
      projectId: env.INFISICAL_PROJECT_ID,
      environment: env.INFISICAL_ENVIRONMENT,
      secretPath: env.INFISICAL_SECRET_PATH,
    }, fetcher) : null;
  }

  async readCredentials(): Promise<IntegrationCredentials> {
    if (this.store) return this.store.readCredentials();
    if (this.mode === 'environment') {
      const stripe = this.env.STRIPE_SECRET_KEY && this.env.STRIPE_WEBHOOK_SECRET
        ? { secretKey: this.env.STRIPE_SECRET_KEY, webhookSecret: this.env.STRIPE_WEBHOOK_SECRET }
        : null;
      const gmail = this.env.GMAIL_CLIENT_ID && this.env.GMAIL_CLIENT_SECRET && this.env.GMAIL_REFRESH_TOKEN
        ? { clientId: this.env.GMAIL_CLIENT_ID, clientSecret: this.env.GMAIL_CLIENT_SECRET, refreshToken: this.env.GMAIL_REFRESH_TOKEN }
        : null;
      return { stripe, gmail };
    }
    return { stripe: null, gmail: null };
  }

  async status(): Promise<IntegrationStatus> {
    if (this.store) return { ...await this.store.getStatus(), mode: this.mode };
    const credentials = await this.readCredentials();
    return {
      mode: this.mode,
      stripe: { configured: credentials.stripe !== null, updatedAt: null },
      gmail: { configured: credentials.gmail !== null, updatedAt: null },
    };
  }

  async replaceStripe(credentials: StripeIntegrationCredentials): Promise<void> {
    if (!this.store) throw new IntegrationSettingsUnavailableError();
    await this.store.replaceStripe(credentials);
  }

  async replaceGmail(credentials: GmailIntegrationCredentials): Promise<void> {
    if (!this.store) throw new IntegrationSettingsUnavailableError();
    await this.store.replaceGmail(credentials);
  }
}
