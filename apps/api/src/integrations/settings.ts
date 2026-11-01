import type { Env } from '../env';
import {
  INFISICAL_CLOUD_API_URLS,
  InfisicalSecretStore,
  type GmailIntegrationCredentials,
  type IntegrationCredentialStatus,
  type IntegrationCredentials,
  type InfisicalConnectionSettings,
  type StripeIntegrationCredentials,
} from './infisical';

export type IntegrationMode = 'fake' | 'environment' | 'infisical';
export type InfisicalConnectionStatus = {
  configured: boolean;
  connected: boolean;
  apiUrl: string | null;
  projectId: string | null;
  environment: string | null;
  secretPath: string | null;
  updatedAt: string | null;
};
export type IntegrationStatus = IntegrationCredentialStatus & {
  mode: IntegrationMode;
  infisical: InfisicalConnectionStatus;
};

export class IntegrationSettingsUnavailableError extends Error {
  constructor() {
    super('Integration credentials can only be replaced through the configured secret manager.');
    this.name = 'IntegrationSettingsUnavailableError';
  }
}

export class IntegrationSettings {
  readonly mode: IntegrationMode;
  private store: InfisicalSecretStore | null;
  private connection: InfisicalConnectionSettings | null;
  private connectionUpdatedAt: string | null = null;

  constructor(private readonly env: Env, private readonly fetcher: typeof fetch = fetch) {
    const configured = env.NODE_ENV !== 'test' && Boolean(
      env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID && env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET &&
      env.INFISICAL_PROJECT_ID && env.INFISICAL_ENVIRONMENT,
    );
    this.mode = configured ? 'infisical' : env.NODE_ENV === 'production' ? 'environment' : 'fake';
    this.connection = configured ? {
      apiUrl: env.INFISICAL_API_URL.replace(/\/+$/, ''),
      projectId: env.INFISICAL_PROJECT_ID.trim(),
      environment: env.INFISICAL_ENVIRONMENT.trim(),
      secretPath: env.INFISICAL_SECRET_PATH.trim(),
    } : null;
    this.store = this.connection ? this.createStore(this.connection) : null;
  }

  private createStore(connection: InfisicalConnectionSettings): InfisicalSecretStore {
    return new InfisicalSecretStore({
      baseUrl: connection.apiUrl,
      clientId: this.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID,
      clientSecret: this.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET,
      projectId: connection.projectId,
      environment: connection.environment,
      secretPath: connection.secretPath,
    }, this.fetcher);
  }

  private validateConnection(connection: InfisicalConnectionSettings): void {
    if (!INFISICAL_CLOUD_API_URLS.includes(connection.apiUrl as typeof INFISICAL_CLOUD_API_URLS[number]) ||
        !connection.projectId.trim() || !connection.environment.trim() || !connection.secretPath.startsWith('/')) {
      throw new Error('Invalid Infisical connection settings.');
    }
  }

  connectionSettings(connected = false): InfisicalConnectionStatus {
    return {
      configured: this.mode === 'infisical' && this.connection !== null,
      connected,
      apiUrl: this.connection?.apiUrl ?? null,
      projectId: this.connection?.projectId ?? null,
      environment: this.connection?.environment ?? null,
      secretPath: this.connection?.secretPath ?? null,
      updatedAt: this.connectionUpdatedAt,
    };
  }

  configureConnection(connection: InfisicalConnectionSettings, updatedAt: Date | string | null = null): void {
    if (this.mode !== 'infisical') throw new IntegrationSettingsUnavailableError();
    this.validateConnection(connection);
    this.connection = { ...connection };
    this.connectionUpdatedAt = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
    this.store = this.createStore(connection);
  }

  async testConnection(connection: InfisicalConnectionSettings): Promise<IntegrationCredentials> {
    if (this.mode !== 'infisical') throw new IntegrationSettingsUnavailableError();
    this.validateConnection(connection);
    return this.createStore(connection).readCredentials();
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
    if (this.store) {
      try {
        return { ...await this.store.getStatus(), mode: this.mode, infisical: this.connectionSettings(true) };
      } catch {
        return {
          mode: this.mode,
          infisical: this.connectionSettings(),
          stripe: { configured: false, updatedAt: null },
          gmail: { configured: false, updatedAt: null },
        };
      }
    }
    const credentials = await this.readCredentials();
    return {
      mode: this.mode,
      infisical: this.connectionSettings(),
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
