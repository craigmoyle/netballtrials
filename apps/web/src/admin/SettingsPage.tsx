import { useEffect, useState, type FormEvent } from 'react';
import type { AutomaticEmailSettingsDTO, IntegrationStatusDTO } from '@netball-trials/types';
import { ApiError, type ApiClient as Client } from '../api/client';
import { HelpTip } from './HelpTip';
import { emailPreview } from './automatic-email-preview';

export function SettingsPage({ client }: { client: Client }) {
  const [settings, setSettings] = useState<IntegrationStatusDTO | null>(null);
  const [automaticEmail, setAutomaticEmail] = useState<AutomaticEmailSettingsDTO | null>(null);
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
      const [loaded, loadedEmail] = await Promise.all([client.getIntegrationSettings(), client.getAutomaticEmailSettings()]);
      setSettings(loaded);
      setAutomaticEmail(loadedEmail);
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

  async function saveAutomaticEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!automaticEmail || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { updatedAt: _updatedAt, ...input } = automaticEmail;
      setAutomaticEmail(await client.updateAutomaticEmailSettings(input));
      setNotice('Automatic email settings saved. Existing deliveries keep their original content.');
    } catch (reason) {
      if (reason instanceof ApiError && reason.message === 'invalid_email_template') {
        setError(`Check placeholders in ${reason.fields?.join(', ') || 'the email templates'}. Required event details must stay in the message.`);
      } else setError('Could not save automatic email settings. Check the message fields and try again.');
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
        <p className="message-confirmation">This test environment uses fake payment and email providers. Real credentials and Infisical settings are intentionally disabled here; configure them on the production API deployment.</p>
      ) : null}
      {settings?.mode === 'environment' ? (
        <section className="site-settings-section" aria-labelledby="infisical-integration-heading">
          <h2 id="infisical-integration-heading">Infisical secret manager</h2>
          <p>Infisical is not enabled for this API deployment, so connection fields are not editable here. To enable them, configure these four variables on the API service: <code>INFISICAL_UNIVERSAL_AUTH_CLIENT_ID</code>, <code>INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET</code>, <code>INFISICAL_PROJECT_ID</code> and <code>INFISICAL_ENVIRONMENT</code>.</p>
          <p>Keep the Universal Auth client ID and secret in your hosting provider’s secret settings—not in this form. After configuring the values for a production deployment, restart or redeploy the API. You can then manage the Infisical region, project, environment and secret path here.</p>
        </section>
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
      <section className="site-settings-section automatic-email-settings" aria-labelledby="automatic-email-heading">
        <div className="admin-page-title-row"><h2 id="automatic-email-heading">Automatic email messages</h2><HelpTip label="Confirmation and reminder emails">These messages are sent by the app after payment and before a trial. Ticket links, the QR image and calendar attachment stay in place.</HelpTip></div>
        <p>Update the subject and plain-text copy for registration confirmations and event reminders. Use the listed fields to insert event and player details.</p>
        {automaticEmail ? (
          <form onSubmit={(event) => void saveAutomaticEmail(event)}>
            <fieldset disabled={busy}>
              <legend>Successful registration</legend>
              <p className="template-field-help">Required in the message: <code>{'{{playerName}}'}</code>, <code>{'{{eventName}}'}</code>, <code>{'{{eventDate}}'}</code>, <code>{'{{gameStartTime}}'}</code> and <code>{'{{venue}}'}</code>. The ticket, manage-registration and policy links, QR code and calendar file are added automatically.</p>
              <label htmlFor="confirmation-email-subject">Confirmation subject</label>
              <input id="confirmation-email-subject" maxLength={200} value={automaticEmail.confirmationSubject} onChange={(event) => setAutomaticEmail({ ...automaticEmail, confirmationSubject: event.target.value })} />
              <label htmlFor="confirmation-email-body">Message</label>
              <textarea id="confirmation-email-body" rows={5} maxLength={3000} value={automaticEmail.confirmationBody} onChange={(event) => setAutomaticEmail({ ...automaticEmail, confirmationBody: event.target.value })} />
              <details className="automatic-email-preview">
                <summary>Preview with sample details</summary>
                <p><strong>{emailPreview(automaticEmail, 'confirmation').subject}</strong></p>
                <pre>{emailPreview(automaticEmail, 'confirmation').body}</pre>
                <p>Ticket links, the QR code and calendar attachment appear in the sent email.</p>
              </details>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Event reminder</legend>
              <p className="template-field-help">Use <code>{'{{eventName}}'}</code>, <code>{'{{eventDate}}'}</code>, <code>{'{{startTime}}'}</code> and <code>{'{{venue}}'}</code>. The calendar attachment is added automatically.</p>
              <label htmlFor="reminder-email-subject">Reminder subject</label>
              <input id="reminder-email-subject" maxLength={200} value={automaticEmail.reminderSubject} onChange={(event) => setAutomaticEmail({ ...automaticEmail, reminderSubject: event.target.value })} />
              <label htmlFor="reminder-email-body">Message</label>
              <textarea id="reminder-email-body" rows={4} maxLength={3000} value={automaticEmail.reminderBody} onChange={(event) => setAutomaticEmail({ ...automaticEmail, reminderBody: event.target.value })} />
              <details className="automatic-email-preview">
                <summary>Preview with sample details</summary>
                <p><strong>{emailPreview(automaticEmail, 'reminder').subject}</strong></p>
                <pre>{emailPreview(automaticEmail, 'reminder').body}</pre>
              </details>
              <div className="automatic-email-label-row"><label htmlFor="reminder-lead-hours">Send reminder (hours before event start)</label><HelpTip label="Reminder timing">The reminder job sends once an event enters this lead-time window. Keep the job scheduled at least every 15 minutes; the actual send can be up to 15 minutes after the window opens.</HelpTip></div>
              <input id="reminder-lead-hours" type="number" min={1} max={168} step={1} value={automaticEmail.reminderLeadHours} onChange={(event) => setAutomaticEmail({ ...automaticEmail, reminderLeadHours: Number(event.target.value) })} />
            </fieldset>
            <button type="submit" disabled={busy || !automaticEmail.confirmationSubject.trim() || !automaticEmail.confirmationBody.trim() || !automaticEmail.reminderSubject.trim() || !automaticEmail.reminderBody.trim() || automaticEmail.reminderLeadHours < 1 || automaticEmail.reminderLeadHours > 168}>{busy ? 'Saving…' : 'Save automatic email settings'}</button>
          </form>
        ) : <p role="status">Automatic email settings are unavailable. Reload the page to try again.</p>}
        {automaticEmail?.updatedAt ? <p>Last updated {new Date(automaticEmail.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })}.</p> : null}
      </section>
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
