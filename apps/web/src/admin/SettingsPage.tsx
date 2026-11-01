import { useEffect, useState, type FormEvent } from 'react';
import type { IntegrationStatusDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

export function SettingsPage({ client }: { client: Client }) {
  const [settings, setSettings] = useState<IntegrationStatusDTO | null>(null);
  const [infisicalApiUrl, setInfisicalApiUrl] = useState('https://us.infisical.com');
  const [infisicalProjectId, setInfisicalProjectId] = useState('');
  const [infisicalEnvironment, setInfisicalEnvironment] = useState('');
  const [infisicalSecretPath, setInfisicalSecretPath] = useState('/');
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [gmailClientId, setGmailClientId] = useState('');
  const [gmailClientSecret, setGmailClientSecret] = useState('');
  const [gmailRefreshToken, setGmailRefreshToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const loaded = await client.getIntegrationSettings();
      setSettings(loaded);
      if (loaded.infisical.configured) {
        setInfisicalApiUrl(loaded.infisical.apiUrl ?? 'https://us.infisical.com');
        setInfisicalProjectId(loaded.infisical.projectId ?? '');
        setInfisicalEnvironment(loaded.infisical.environment ?? '');
        setInfisicalSecretPath(loaded.infisical.secretPath ?? '/');
      }
    } catch {
      setError('Could not load integration settings. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [client]);

  async function saveInfisical(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!infisicalProjectId.trim() || !infisicalEnvironment.trim() || !infisicalSecretPath.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await client.updateInfisicalConnection({
        apiUrl: infisicalApiUrl,
        projectId: infisicalProjectId.trim(),
        environment: infisicalEnvironment.trim(),
        secretPath: infisicalSecretPath.trim(),
      });
      setSettings(updated);
      setNotice('Infisical connection verified and saved. Universal Auth credentials remain deployment-managed.');
    } catch {
      setError('Could not verify or save Infisical settings. Check the machine identity scope and ensure both STRIPE_INTEGRATION and GMAIL_INTEGRATION exist at the selected path.');
    } finally {
      setBusy(false);
    }
  }

  async function saveStripe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripeSecretKey.trim() || !stripeWebhookSecret.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setSettings(await client.replaceStripeIntegration({ secretKey: stripeSecretKey.trim(), webhookSecret: stripeWebhookSecret.trim() }));
      setStripeSecretKey('');
      setStripeWebhookSecret('');
      setNotice('Stripe credentials replaced. Saved values are not shown here.');
    } catch {
      setError('Could not update Stripe credentials. Check the values and Infisical configuration, then retry.');
    } finally {
      setBusy(false);
    }
  }

  async function saveGmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gmailClientId.trim() || !gmailClientSecret.trim() || !gmailRefreshToken.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setSettings(await client.replaceGmailIntegration({
        clientId: gmailClientId.trim(),
        clientSecret: gmailClientSecret.trim(),
        refreshToken: gmailRefreshToken.trim(),
      }));
      setGmailClientId('');
      setGmailClientSecret('');
      setGmailRefreshToken('');
      setNotice('Gmail credentials replaced. Saved values are not shown here.');
    } catch {
      setError('Could not update Gmail credentials. Check the values and Infisical configuration, then retry.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Loading site settings…</p>;

  return (
    <section className="site-settings-page">
      <h1>Settings</h1>
      <p>Manage site-wide integrations. Event dates, fees and eligibility stay in each event.</p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {settings?.mode === 'fake' ? (
        <p className="message-confirmation">This test environment uses fake payment and email providers. Real credentials cannot be added here.</p>
      ) : null}
      {settings?.mode === 'environment' ? (
        <p className="message-confirmation">Integration credentials are managed by the deployment environment. Add Infisical Universal Auth credentials there to enable connection settings here.</p>
      ) : null}
      {settings?.mode === 'infisical' ? (
        <section className="site-settings-section" aria-labelledby="infisical-integration-heading">
          <h2 id="infisical-integration-heading">Infisical secret manager</h2>
          <p>Region, project, environment and path are stored as non-secret configuration. The Universal Auth client ID and secret stay in deployment secret settings and are never shown or stored in the application database.</p>
          <p>{settings.infisical.connected ? 'Infisical is reachable with the current settings.' : 'Infisical could not be reached with the current settings; update them below to restore the connection.'}</p>
          <p>Test and save requires both Stripe and Gmail secret records to exist in the selected project, environment and path.</p>
          {settings.infisical.updatedAt ? <p>Infisical connection or integration settings last updated {new Date(settings.infisical.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })}.</p> : null}
          <form onSubmit={(event) => void saveInfisical(event)}>
            <label htmlFor="infisical-api-url">Infisical Cloud region</label>
            <select id="infisical-api-url" value={infisicalApiUrl} disabled={busy} onChange={(event) => setInfisicalApiUrl(event.target.value)}>
              <option value="https://us.infisical.com">United States</option>
              <option value="https://eu.infisical.com">Europe</option>
            </select>
            <label htmlFor="infisical-project-id">Project ID</label>
            <input id="infisical-project-id" value={infisicalProjectId} maxLength={200} disabled={busy} onChange={(event) => setInfisicalProjectId(event.target.value)} />
            <label htmlFor="infisical-environment">Environment slug</label>
            <input id="infisical-environment" value={infisicalEnvironment} maxLength={100} disabled={busy} onChange={(event) => setInfisicalEnvironment(event.target.value)} />
            <label htmlFor="infisical-secret-path">Secret path</label>
            <input id="infisical-secret-path" value={infisicalSecretPath} maxLength={500} disabled={busy} onChange={(event) => setInfisicalSecretPath(event.target.value)} />
            <button type="submit" disabled={busy || !infisicalProjectId.trim() || !infisicalEnvironment.trim() || !infisicalSecretPath.trim()}>{busy ? 'Testing connection…' : 'Test connection and save'}</button>
          </form>
        </section>
      ) : null}
      <section className="site-settings-section" aria-labelledby="stripe-integration-heading">
        <h2 id="stripe-integration-heading">Stripe payments</h2>
        <p>{settings?.mode === 'infisical' && !settings.infisical.connected ? 'Credential status is unavailable until Infisical is reachable.' : settings?.stripe.configured ? 'Credentials are configured.' : 'Credentials are not configured.'}{settings?.stripe.updatedAt ? ` Last updated ${new Date(settings.stripe.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })}.` : ''}</p>
        <p>Saved values are write-only. Replacing them updates the secret store; the current values are never displayed.</p>
        <p>Production must use a live Stripe secret key beginning with <code>sk_live_</code>.</p>
        {settings?.mode === 'infisical' ? (
          <form onSubmit={(event) => void saveStripe(event)}>
            <label htmlFor="stripe-secret-key">New Stripe secret key</label>
            <input id="stripe-secret-key" type="password" autoComplete="new-password" value={stripeSecretKey} onChange={(event) => setStripeSecretKey(event.target.value)} />
            <label htmlFor="stripe-webhook-secret">New Stripe webhook signing secret</label>
            <input id="stripe-webhook-secret" type="password" autoComplete="new-password" value={stripeWebhookSecret} onChange={(event) => setStripeWebhookSecret(event.target.value)} />
            <button type="submit" disabled={busy || !settings.infisical.connected || !stripeSecretKey.trim() || !stripeWebhookSecret.trim()}>{busy ? 'Saving…' : 'Replace Stripe credentials'}</button>
          </form>
        ) : null}
      </section>
      <section className="site-settings-section" aria-labelledby="gmail-integration-heading">
        <h2 id="gmail-integration-heading">Gmail email</h2>
        <p>{settings?.mode === 'infisical' && !settings.infisical.connected ? 'OAuth credential status is unavailable until Infisical is reachable.' : settings?.gmail.configured ? 'OAuth credentials are configured.' : 'OAuth credentials are not configured.'}{settings?.gmail.updatedAt ? ` Last updated ${new Date(settings.gmail.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })}.` : ''}</p>
        <p>Saved values are write-only. Re-enter all three OAuth values to replace the current Gmail integration.</p>
        {settings?.mode === 'infisical' ? (
          <form onSubmit={(event) => void saveGmail(event)}>
            <label htmlFor="gmail-client-id">New Gmail OAuth client ID</label>
            <input id="gmail-client-id" type="password" autoComplete="new-password" value={gmailClientId} onChange={(event) => setGmailClientId(event.target.value)} />
            <label htmlFor="gmail-client-secret">New Gmail OAuth client secret</label>
            <input id="gmail-client-secret" type="password" autoComplete="new-password" value={gmailClientSecret} onChange={(event) => setGmailClientSecret(event.target.value)} />
            <label htmlFor="gmail-refresh-token">New Gmail OAuth refresh token</label>
            <input id="gmail-refresh-token" type="password" autoComplete="new-password" value={gmailRefreshToken} onChange={(event) => setGmailRefreshToken(event.target.value)} />
            <button type="submit" disabled={busy || !settings.infisical.connected || !gmailClientId.trim() || !gmailClientSecret.trim() || !gmailRefreshToken.trim()}>{busy ? 'Saving…' : 'Replace Gmail credentials'}</button>
          </form>
        ) : null}
      </section>
    </section>
  );
}
