import { useEffect, useState, type FormEvent } from 'react';
import type { IntegrationStatusDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

export function SettingsPage({ client }: { client: Client }) {
  const [settings, setSettings] = useState<IntegrationStatusDTO | null>(null);
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
      setSettings(await client.getIntegrationSettings());
    } catch {
      setError('Could not load integration settings. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [client]);

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
        <p className="message-confirmation">Integration credentials are managed by the deployment environment. Configure Infisical to replace them from this page.</p>
      ) : null}
      <section className="site-settings-section" aria-labelledby="stripe-integration-heading">
        <h2 id="stripe-integration-heading">Stripe payments</h2>
        <p>{settings?.stripe.configured ? 'Credentials are configured.' : 'Credentials are not configured.'}{settings?.stripe.updatedAt ? ` Last updated ${new Date(settings.stripe.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })}.` : ''}</p>
        <p>Saved values are write-only. Replacing them updates the secret store; the current values are never displayed.</p>
        {settings?.mode === 'infisical' ? (
          <form onSubmit={(event) => void saveStripe(event)}>
            <label htmlFor="stripe-secret-key">New Stripe secret key</label>
            <input id="stripe-secret-key" type="password" autoComplete="new-password" value={stripeSecretKey} onChange={(event) => setStripeSecretKey(event.target.value)} />
            <label htmlFor="stripe-webhook-secret">New Stripe webhook signing secret</label>
            <input id="stripe-webhook-secret" type="password" autoComplete="new-password" value={stripeWebhookSecret} onChange={(event) => setStripeWebhookSecret(event.target.value)} />
            <button type="submit" disabled={busy || !stripeSecretKey.trim() || !stripeWebhookSecret.trim()}>{busy ? 'Saving…' : 'Replace Stripe credentials'}</button>
          </form>
        ) : null}
      </section>
      <section className="site-settings-section" aria-labelledby="gmail-integration-heading">
        <h2 id="gmail-integration-heading">Gmail email</h2>
        <p>{settings?.gmail.configured ? 'OAuth credentials are configured.' : 'OAuth credentials are not configured.'}{settings?.gmail.updatedAt ? ` Last updated ${new Date(settings.gmail.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })}.` : ''}</p>
        <p>Saved values are write-only. Re-enter all three OAuth values to replace the current Gmail integration.</p>
        {settings?.mode === 'infisical' ? (
          <form onSubmit={(event) => void saveGmail(event)}>
            <label htmlFor="gmail-client-id">New Gmail OAuth client ID</label>
            <input id="gmail-client-id" type="password" autoComplete="new-password" value={gmailClientId} onChange={(event) => setGmailClientId(event.target.value)} />
            <label htmlFor="gmail-client-secret">New Gmail OAuth client secret</label>
            <input id="gmail-client-secret" type="password" autoComplete="new-password" value={gmailClientSecret} onChange={(event) => setGmailClientSecret(event.target.value)} />
            <label htmlFor="gmail-refresh-token">New Gmail OAuth refresh token</label>
            <input id="gmail-refresh-token" type="password" autoComplete="new-password" value={gmailRefreshToken} onChange={(event) => setGmailRefreshToken(event.target.value)} />
            <button type="submit" disabled={busy || !gmailClientId.trim() || !gmailClientSecret.trim() || !gmailRefreshToken.trim()}>{busy ? 'Saving…' : 'Replace Gmail credentials'}</button>
          </form>
        ) : null}
      </section>
    </section>
  );
}
