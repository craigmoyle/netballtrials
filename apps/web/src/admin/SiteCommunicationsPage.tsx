import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EmailTemplateDTO, EventDTO, MemberAssociationDTO, SiteAssociationCampaignDTO, SiteAssociationCommunicationPreviewDTO } from '@netball-trials/types';
import { ApiError, type ApiClient as Client } from '../api/client';

type Audience = 'participants' | 'associations';
type Tab = 'associations' | 'templates';

function templateErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message === 'unsupported_template_fields'
    ? `Unsupported template field(s): ${error.fields?.join(', ') || 'check the available fields below'}.`
    : fallback;
}

export function SiteCommunicationsPage({ client }: { client: Client }) {
  const [tab, setTab] = useState<Tab>('associations');
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [associations, setAssociations] = useState<MemberAssociationDTO[]>([]);
  const [templates, setTemplates] = useState<EmailTemplateDTO[]>([]);
  const [campaigns, setCampaigns] = useState<SiteAssociationCampaignDTO[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [selectedAssociationIds, setSelectedAssociationIds] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [preview, setPreview] = useState<(SiteAssociationCommunicationPreviewDTO & { count: number }) | null>(null);
  const [sendBatchId, setSendBatchId] = useState<string | null>(null);
  const [templateAudience, setTemplateAudience] = useState<Audience>('associations');
  const [templateName, setTemplateName] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [loadedEvents, loadedAssociations, loadedTemplates, loadedCampaigns] = await Promise.all([
        client.listEvents(), client.listAssociations(), client.listCommunicationTemplates(), client.listSiteAssociationCampaigns(),
      ]);
      setEvents(loadedEvents);
      setAssociations(loadedAssociations.filter((association) => association.active && association.primaryContactEmail));
      setTemplates(loadedTemplates);
      setCampaigns(loadedCampaigns);
    } catch {
      setError('Could not load communications. Check your connection, then retry.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [client]);

  const availableTemplates = useMemo(() => templates.filter((template) => template.audience === 'associations'), [templates]);

  function invalidatePreview() {
    setPreview(null);
    setSendBatchId(null);
  }

  function toggleSelection(current: string[], id: string, checked: boolean): string[] {
    return checked ? [...new Set([...current, id])] : current.filter((value) => value !== id);
  }

  function selectTemplate(id: string) {
    const template = availableTemplates.find((item) => item.id === id);
    if (!template) return;
    setSubject(template.subject);
    setText(template.body);
    invalidatePreview();
  }

  async function previewMessage() {
    if (!selectedEventIds.length || !selectedAssociationIds.length || !subject.trim() || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.previewSiteAssociationCommunication({
        eventIds: selectedEventIds, associationIds: selectedAssociationIds, subject, text,
      });
      setPreview(result);
      setSendBatchId(crypto.randomUUID());
    } catch (error) {
      setError(templateErrorMessage(error, 'Could not preview the selected events and associations. The message is still here; try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    if (!preview?.count || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const batchId = sendBatchId ?? crypto.randomUUID();
      setSendBatchId(batchId);
      const result = await client.sendSiteAssociationCommunication({
        eventIds: selectedEventIds, associationIds: selectedAssociationIds, subject, text, batchId,
      });
      setNotice(result.status === 'COMPLETED' ? `Message sent to ${result.deliveries.length} association contacts.` : `Message status: ${result.status.toLowerCase()}. Review delivery history below.`);
      invalidatePreview();
      setSelectedAssociationIds([]);
      await load();
    } catch (error) {
      setError(templateErrorMessage(error, 'Could not send this message. Check the delivery history before trying again.'));
    } finally {
      setBusy(false);
    }
  }

  async function scheduleMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview?.count || !scheduleAt || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const batchId = sendBatchId ?? crypto.randomUUID();
      setSendBatchId(batchId);
      await client.scheduleSiteAssociationCommunication({
        eventIds: selectedEventIds, associationIds: selectedAssociationIds, subject, text, scheduledLocal: scheduleAt, batchId,
      });
      setNotice('Association message scheduled.');
      invalidatePreview();
      setSelectedAssociationIds([]);
      setScheduleAt('');
      await load();
    } catch (error) {
      setError(templateErrorMessage(error, 'Could not schedule this message. Choose a future Melbourne time and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateName.trim() || !templateSubject.trim() || !templateBody.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input = { name: templateName.trim(), audience: templateAudience, subject: templateSubject.trim(), body: templateBody.trim() };
      const saved = editingTemplateId
        ? await client.updateCommunicationTemplate(editingTemplateId, input)
        : await client.saveCommunicationTemplate(input);
      setTemplates((current) => [...current.filter((template) => template.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setEditingTemplateId(null);
      setTemplateName('');
      setTemplateSubject('');
      setTemplateBody('');
      setNotice('Email template saved.');
    } catch (error) {
      setError(templateErrorMessage(error, 'Could not save this template. Check that its name is unique and its placeholders are supported.'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(template: EmailTemplateDTO) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.deleteCommunicationTemplate(template.id);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (editingTemplateId === template.id) {
        setEditingTemplateId(null);
        setTemplateName('');
        setTemplateSubject('');
        setTemplateBody('');
      }
      setNotice(`Template ${template.name} deleted.`);
    } catch {
      setError(`Could not delete template ${template.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function cancelCampaign(campaignId: string) {
    setBusy(true);
    setError(null);
    try {
      await client.cancelSiteAssociationCommunication(campaignId);
      setNotice('Scheduled association message cancelled.');
      await load();
    } catch {
      setError('This message may already be sending and could not be cancelled. Refresh the schedule to check.');
    } finally {
      setBusy(false);
    }
  }

  async function retryCampaign(campaign: SiteAssociationCampaignDTO) {
    const retryable = campaign.deliveries.filter((delivery) => delivery.status === 'FAILED').map((delivery) => delivery.id);
    if (!retryable.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.retrySiteAssociationCommunication(campaign.id, retryable);
      setNotice('Failed deliveries retried.');
      await load();
    } catch {
      setError('Could not retry these deliveries. Refresh the delivery history and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Loading communications...</p>;

  return (
    <section className="communications-page">
      <h1>Communications</h1>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="communications-tabs" role="group" aria-label="Communications sections">
        <button type="button" aria-pressed={tab === 'associations'} onClick={() => setTab('associations')}>Association messages</button>
        <button type="button" aria-pressed={tab === 'templates'} onClick={() => setTab('templates')}>Email templates</button>
      </div>

      {tab === 'associations' ? (
        <>
          <p>Send one message to selected association contacts with details for one or more events. Scheduled messages use Melbourne time.</p>
          <section aria-labelledby="site-events-heading">
            <h2 id="site-events-heading">Events to include</h2>
            {events.length ? <ul className="site-selection-list">{events.map((event) => (
              <li key={event.id}><label><input type="checkbox" checked={selectedEventIds.includes(event.id)} onChange={(change) => { setSelectedEventIds((current) => toggleSelection(current, event.id, change.target.checked)); invalidatePreview(); }} />
                {event.name} — {new Date(event.eventDate).toLocaleDateString('en-AU', { timeZone: 'UTC' })} · {event.division} {event.section} · {event.status.toLowerCase()}
              </label></li>
            ))}</ul> : <p>No events are available.</p>}
          </section>
          <section aria-labelledby="site-associations-heading">
            <h2 id="site-associations-heading">Association contacts</h2>
            {associations.length ? <ul className="site-selection-list">{associations.map((association) => (
              <li key={association.id}><label><input type="checkbox" checked={selectedAssociationIds.includes(association.id)} onChange={(change) => { setSelectedAssociationIds((current) => toggleSelection(current, association.id, change.target.checked)); invalidatePreview(); }} />
                {association.name}{association.primaryContactName ? ` — ${association.primaryContactName}` : ''} — {association.primaryContactEmail}
              </label></li>
            ))}</ul> : <p>No active association contacts have an email address.</p>}
          </section>
          <section aria-labelledby="site-compose-heading">
            <h2 id="site-compose-heading">Compose message</h2>
            <p><label htmlFor="site-template-select">Use an association template</label><select id="site-template-select" value="" onChange={(change) => selectTemplate(change.target.value)}>
              <option value="">Choose a template</option>{availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select></p>
            <p><label htmlFor="site-subject">Subject</label><input id="site-subject" maxLength={200} value={subject} onChange={(change) => { setSubject(change.target.value); invalidatePreview(); }} /></p>
            <p><label htmlFor="site-body">Message</label><textarea id="site-body" maxLength={5000} value={text} onChange={(change) => { setText(change.target.value); invalidatePreview(); }} /></p>
            <p className="template-field-help">Available fields: <code>{'{{associationName}}'}</code>, <code>{'{{contactName}}'}</code>, <code>{'{{eventName}}'}</code>, <code>{'{{eventDate}}'}</code>, <code>{'{{arrivalTime}}'}</code>, <code>{'{{startTime}}'}</code>, <code>{'{{venue}}'}</code>, and <code>{'{{eventList}}'}</code>.</p>
            <button type="button" disabled={busy || !selectedEventIds.length || !selectedAssociationIds.length || !subject.trim() || !text.trim()} onClick={() => void previewMessage()}>{busy ? 'Working...' : 'Preview message'}</button>
          </section>
          {preview ? (
            <section className="message-confirmation" aria-labelledby="site-preview-heading">
              <h2 id="site-preview-heading">Review association message</h2>
              <p>{preview.count} distinct association contact{preview.count === 1 ? '' : 's'} will receive this message.</p>
              <p><strong>{preview.subject}</strong></p><pre>{preview.text}</pre>
              <ul>{preview.recipients.map((recipient) => <li key={recipient.id}>{recipient.name} — {recipient.email}</li>)}</ul>
              <button type="button" disabled={busy || preview.count === 0} onClick={() => void sendNow()}>{busy ? 'Sending...' : `Send now to ${preview.count}`}</button>
              <form onSubmit={(event) => void scheduleMessage(event)}>
                <fieldset className="form-group">
                  <legend>Schedule this message</legend>
                  <p><label htmlFor="site-scheduled-local">Send at (Australia/Melbourne)</label><input id="site-scheduled-local" type="datetime-local" value={scheduleAt} onChange={(change) => setScheduleAt(change.target.value)} /></p>
                  <button type="submit" className="button-secondary" disabled={busy || !scheduleAt || preview.count === 0}>{busy ? 'Scheduling...' : 'Schedule email'}</button>
                </fieldset>
              </form>
            </section>
          ) : null}
          <section aria-labelledby="site-campaigns-heading">
            <h2 id="site-campaigns-heading">Association message history</h2>
            {campaigns.length ? <ul>{campaigns.map((campaign) => (
              <li key={campaign.id}>
                <strong>{campaign.subject}</strong> — {campaign.eventNames.join(', ')} — {campaign.status.toLowerCase()}
                <p>{campaign.deliveries.length} association contact(s) · {campaign.deliveries.filter((delivery) => delivery.status === 'SENT').length} sent · {campaign.deliveries.filter((delivery) => delivery.status === 'FAILED').length} failed</p>
                {campaign.scheduledAt && campaign.status === 'SCHEDULED' ? <p>Scheduled {new Date(campaign.scheduledAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })} <button type="button" className="button-secondary" disabled={busy} onClick={() => void cancelCampaign(campaign.id)}>Cancel scheduled message</button></p> : null}
                {campaign.deliveries.some((delivery) => delivery.status === 'FAILED') ? <button type="button" className="button-secondary" disabled={busy} onClick={() => void retryCampaign(campaign)}>Retry failed deliveries</button> : null}
              </li>
            ))}</ul> : <p>No site-level association messages yet.</p>}
          </section>
        </>
      ) : (
        <>
          <p>Templates are shared between event and site-level communications. Use the audience to keep participant and association fields separate.</p>
          <form onSubmit={(event) => void saveTemplate(event)}>
            <p><label htmlFor="template-audience">Audience</label><select id="template-audience" value={templateAudience} disabled={busy} onChange={(change) => setTemplateAudience(change.target.value as Audience)}>
              <option value="associations">Member associations</option><option value="participants">Event participants</option>
            </select></p>
            <p><label htmlFor="template-name">Template name</label><input id="template-name" maxLength={100} value={templateName} onChange={(change) => setTemplateName(change.target.value)} /></p>
            <p><label htmlFor="template-subject">Subject</label><input id="template-subject" maxLength={200} value={templateSubject} onChange={(change) => setTemplateSubject(change.target.value)} /></p>
            <p><label htmlFor="template-body">Message</label><textarea id="template-body" maxLength={5000} value={templateBody} onChange={(change) => setTemplateBody(change.target.value)} /></p>
            <p className="template-field-help">{templateAudience === 'associations'
              ? <>Available fields: <code>{'{{associationName}}'}</code>, <code>{'{{contactName}}'}</code>, <code>{'{{eventName}}'}</code>, <code>{'{{eventDate}}'}</code>, <code>{'{{arrivalTime}}'}</code>, <code>{'{{startTime}}'}</code>, <code>{'{{venue}}'}</code>, and <code>{'{{eventList}}'}</code>.</>
              : <>Available fields: <code>{'{{playerFirstName}}'}</code>, <code>{'{{playerLastName}}'}</code>, <code>{'{{playerName}}'}</code>, <code>{'{{playerNames}}'}</code>, <code>{'{{playerNumber}}'}</code>, <code>{'{{parentName}}'}</code>, <code>{'{{associationName}}'}</code>, <code>{'{{eventName}}'}</code>, <code>{'{{eventDate}}'}</code>, <code>{'{{arrivalTime}}'}</code>, <code>{'{{startTime}}'}</code>, <code>{'{{venue}}'}</code>.</>}</p>
            <button type="submit" disabled={busy || !templateName.trim() || !templateSubject.trim() || !templateBody.trim()}>{busy ? 'Saving...' : editingTemplateId ? 'Update template' : 'Save template'}</button>
            {editingTemplateId ? <button type="button" className="button-secondary" disabled={busy} onClick={() => { setEditingTemplateId(null); setTemplateName(''); setTemplateSubject(''); setTemplateBody(''); }}>Cancel template edit</button> : null}
          </form>
          {templates.length ? <ul aria-label="Saved email templates">{templates.map((template) => (
            <li key={template.id}>
              <strong>{template.name}</strong> — {template.audience}
              <button type="button" className="button-secondary" disabled={busy} onClick={() => { setEditingTemplateId(template.id); setTemplateAudience(template.audience); setTemplateName(template.name); setTemplateSubject(template.subject); setTemplateBody(template.body); }}>Edit</button>
              <button type="button" className="button-secondary" disabled={busy} onClick={() => void deleteTemplate(template)}>Delete</button>
            </li>
          ))}</ul> : <p>No email templates saved.</p>}
        </>
      )}
    </section>
  );
}
