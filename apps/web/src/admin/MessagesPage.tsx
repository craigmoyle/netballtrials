import { useEffect, useMemo, useState } from 'react';
import type { CommunicationRecipientDTO, EmailLogDTO, EmailTemplateDTO, ScheduledMessageDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

type Audience = 'participants' | 'associations';
type FilterStatus = 'all' | 'PAID' | 'PENDING' | 'EXPIRED' | 'FAILED' | 'WITHDRAWN' | 'checked-in' | 'not-checked-in';

function recipientStatus(recipient: CommunicationRecipientDTO): string {
  if (recipient.registrationStatus === null) return 'Association contact';
  if (recipient.checkedIn) return `${recipient.registrationStatus} · Checked in`;
  return `${recipient.registrationStatus} · ${recipient.registrationStatus === 'PAID' ? 'No-show' : 'Not checked in'}`;
}

function deliveryStatus(entry: EmailLogDTO): string {
  if (entry.status === 'FAILED') return `failed: ${entry.error ?? 'delivery rejected'}`;
  if (entry.status === 'AMBIGUOUS') return `outcome unknown: ${entry.error ?? 'provider may have accepted the message'}`;
  return entry.status.toLowerCase();
}

export function MessagesPage({ client, eventId }: { client: Client; eventId: string }) {
  return <CommunicationsPage key={eventId} client={client} eventId={eventId} />;
}

function CommunicationsPage({ client, eventId }: { client: Client; eventId: string }) {
  const [audience, setAudience] = useState<Audience>('participants');
  const [participants, setParticipants] = useState<CommunicationRecipientDTO[]>([]);
  const [associations, setAssociations] = useState<CommunicationRecipientDTO[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [templates, setTemplates] = useState<EmailTemplateDTO[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessageDTO[]>([]);
  const [deliveries, setDeliveries] = useState<EmailLogDTO[]>([]);
  const [policyDocumentName, setPolicyDocumentName] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [associationFilter, setAssociationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [positionFilter, setPositionFilter] = useState('all');
  const [previewRecipients, setPreviewRecipients] = useState<CommunicationRecipientDTO[] | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [recipientLists, savedTemplates, queued, history, event] = await Promise.all([
        client.getCommunicationRecipients(eventId),
        client.listCommunicationTemplates(),
        client.listScheduledCommunications(eventId),
        client.listCommunicationDeliveries(eventId),
        client.getEvent(eventId),
      ]);
      setParticipants(recipientLists.participants);
      setAssociations(recipientLists.associations);
      setTemplates(savedTemplates);
      setScheduled(queued);
      setDeliveries(history);
      setPolicyDocumentName(event.policyDocumentName);
    } catch {
      setError('Could not load communications. Check your connection, then retry.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [client, eventId]);

  const allRecipients = audience === 'participants' ? participants : associations;
  const associationNames = [...new Set(participants.map((recipient) => recipient.association).filter((value): value is string => Boolean(value)))].sort();
  const filteredRecipients = useMemo(() => allRecipients.filter((recipient) => {
    const query = search.trim().toLocaleLowerCase();
    if (query && !`${recipient.name} ${recipient.email} ${recipient.number ?? ''}`.toLocaleLowerCase().includes(query)) return false;
    if (audience === 'participants') {
      if (associationFilter !== 'all' && recipient.association !== associationFilter) return false;
      if (['PAID', 'PENDING', 'EXPIRED', 'FAILED', 'WITHDRAWN'].includes(statusFilter)) {
        if (recipient.registrationStatus !== statusFilter) return false;
      } else if (statusFilter === 'checked-in' && recipient.checkedIn !== true) return false;
      else if (statusFilter === 'not-checked-in' && (recipient.registrationStatus !== 'PAID' || recipient.checkedIn)) return false;
      if (positionFilter !== 'all' && !recipient.positions.includes(positionFilter as CommunicationRecipientDTO['positions'][number])) return false;
    }
    return true;
  }), [allRecipients, audience, associationFilter, positionFilter, search, statusFilter]);
  const eligibleVisibleRecipients = filteredRecipients.filter((recipient) => Boolean(recipient.email.trim()) &&
    (audience === 'associations' || recipient.registrationStatus === 'PAID'));
  const selectedVisibleCount = filteredRecipients.filter((recipient) => selectedIds.includes(recipient.id)).length;

  function changeAudience(next: Audience) {
    setAudience(next);
    setEditingTemplateId(null);
    setTemplateName('');
    setSelectedIds([]);
    setPreviewRecipients(null);
    setAssociationFilter('all');
    setStatusFilter('all');
    setPositionFilter('all');
  }

  function toggleRecipient(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
    setPreviewRecipients(null);
  }

  function selectVisible(checked: boolean) {
    const visibleIds = filteredRecipients
      .filter((recipient) => Boolean(recipient.email.trim()) && (audience === 'associations' || recipient.registrationStatus === 'PAID'))
      .map((recipient) => recipient.id);
    setSelectedIds((current) => checked ? [...new Set([...current, ...visibleIds])] : current.filter((id) => !visibleIds.includes(id)));
    setPreviewRecipients(null);
  }

  function selectTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template || template.audience !== audience) return;
    setSubject(template.subject);
    setText(template.body);
  }

  async function preview() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.previewCommunication(eventId, { audience, recipientIds: selectedIds });
      setPreviewRecipients(result.recipients);
      if (!result.count) setError('No eligible recipients are selected. Choose paid players or active association contacts.');
    } catch {
      setError('Could not preview the selected recipients. Your message is still here; try again.');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!previewRecipients?.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.sendCommunication(eventId, {
        audience, recipientIds: previewRecipients.map((recipient) => recipient.id), subject, text,
        batchId: crypto.randomUUID(),
      });
      setNotice(`${result.sent} sent, ${result.failed} failed${result.ambiguous ? `, ${result.ambiguous} outcome unknown` : ''}.`);
      setSelectedIds([]);
      setPreviewRecipients(null);
      await load();
    } catch {
      setError('Could not send this message. Check the delivery history before trying again.');
    } finally {
      setBusy(false);
    }
  }

  async function schedule() {
    if (!previewRecipients?.length || !scheduleAt) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.scheduleCommunication(eventId, {
        audience, recipientIds: previewRecipients.map((recipient) => recipient.id), subject, text, scheduledLocal: scheduleAt,
      });
      setScheduled((current) => [result, ...current]);
      setNotice('Message scheduled. Recipients and eligibility will be checked again when it sends.');
      setSelectedIds([]);
      setPreviewRecipients(null);
    } catch {
      setError('Could not schedule this message. Choose a future Melbourne time and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(template: EmailTemplateDTO) {
    setBusy(true);
    setError(null);
    try {
      await client.deleteCommunicationTemplate(template.id);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (editingTemplateId === template.id) { setEditingTemplateId(null); setTemplateName(''); }
      setNotice(`Template ${template.name} deleted.`);
    } catch {
      setError(`Could not delete template ${template.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!templateName.trim() || !subject.trim() || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const input = { name: templateName.trim(), audience, subject: subject.trim(), body: text.trim() };
      const saved = editingTemplateId
        ? await client.updateCommunicationTemplate(editingTemplateId, input)
        : await client.saveCommunicationTemplate(input);
      setTemplates((current) => [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateName('');
      setEditingTemplateId(null);
      setNotice('Template saved.');
    } catch {
      setError('Could not save this template. The name may already be in use.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelScheduled(item: ScheduledMessageDTO) {
    setBusy(true);
    setError(null);
    try {
      await client.cancelScheduledCommunication(eventId, item.id);
      setScheduled((current) => current.map((row) => row.id === item.id ? { ...row, status: 'CANCELLED' } : row));
      setNotice('Scheduled message cancelled.');
    } catch {
      setError('This message may already be sending and could not be cancelled. Refresh the schedule to check.');
    } finally {
      setBusy(false);
    }
  }

  async function retryDelivery(entry: EmailLogDTO, includeAmbiguous = false) {
    if (includeAmbiguous && !window.confirm('The provider may already have accepted this email. Retrying can send a duplicate. Continue?')) return;
    setBusy(true);
    setError(null);
    try {
      await client.retryCommunication(eventId, entry.batchId, [entry.id], includeAmbiguous);
      const [updatedDeliveries, updatedSchedules] = await Promise.all([
        client.listCommunicationDeliveries(eventId), client.listScheduledCommunications(eventId),
      ]);
      setDeliveries(updatedDeliveries);
      setScheduled(updatedSchedules);
      setNotice('Delivery status refreshed.');
    } catch {
      setError('Could not retry this delivery. Check its current status before trying again.');
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
      <div className="communication-audience" role="group" aria-label="Message audience">
        <button type="button" aria-pressed={audience === 'participants'} onClick={() => changeAudience('participants')}>Event participants</button>
        <button type="button" aria-pressed={audience === 'associations'} onClick={() => changeAudience('associations')}>Member associations</button>
      </div>

      <section aria-labelledby="recipient-selection-heading">
        <h2 id="recipient-selection-heading">Recipients</h2>
        <p>Choose recipients, then preview the final list before sending or scheduling.</p>
        <p><label htmlFor="recipient-search">Search recipients</label><input id="recipient-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPreviewRecipients(null); }} placeholder="Name, email or Number" /></p>
        {audience === 'participants' ? (
          <div className="communication-filters">
            <label>Association<select aria-label="Filter by association" value={associationFilter} onChange={(event) => { setAssociationFilter(event.target.value); setPreviewRecipients(null); }}><option value="all">All associations</option>{associationNames.map((name) => <option key={name}>{name}</option>)}</select></label>
            <label>Payment / attendance<select aria-label="Filter by payment or attendance" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as FilterStatus); setPreviewRecipients(null); }}><option value="all">All statuses</option><option value="PAID">Paid</option><option value="PENDING">Pending payment</option><option value="EXPIRED">Expired</option><option value="FAILED">Failed</option><option value="WITHDRAWN">Withdrawn</option><option value="checked-in">Checked in</option><option value="not-checked-in">Paid, not checked in</option></select></label>
            <label>Position<select aria-label="Filter by position" value={positionFilter} onChange={(event) => { setPositionFilter(event.target.value); setPreviewRecipients(null); }}><option value="all">Any chosen position</option>{['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'].map((position) => <option key={position}>{position}</option>)}</select></label>
          </div>
        ) : null}
        <div className="communication-recipient-actions">
          <p className="communication-selected-count" role="status" aria-live="polite">
            {selectedIds.length} selected total · {filteredRecipients.length} shown · {eligibleVisibleRecipients.length} visible eligible
          </p>
          <button type="button" className="button-secondary" disabled={eligibleVisibleRecipients.length === 0} onClick={() => selectVisible(true)}>Select visible eligible</button>{' '}
          <button type="button" className="button-secondary" disabled={selectedVisibleCount === 0} onClick={() => selectVisible(false)}>Clear visible selection</button>
        </div>
        {filteredRecipients.length === 0 ? <p>No recipients match these filters.</p> : (
          <div className="table-scroll communication-recipient-list" role="region" aria-label="Selectable communication recipients" tabIndex={0}>
            <table>
              <caption>{audience === 'participants' ? 'Event participant contacts' : 'Member association primary contacts'}</caption>
              <thead><tr><th scope="col">Include</th><th scope="col">Player / association</th><th scope="col">Number</th><th scope="col">Email</th><th scope="col">Association</th><th scope="col">Status</th><th scope="col">Positions</th></tr></thead>
              <tbody>{filteredRecipients.map((recipient) => {
                const eligible = Boolean(recipient.email.trim()) && (audience === 'associations' || recipient.registrationStatus === 'PAID');
                return <tr key={recipient.id}>
                  <td><input type="checkbox" aria-label={`Include ${recipient.name}`} checked={selectedIds.includes(recipient.id)} disabled={!eligible} onChange={(event) => toggleRecipient(recipient.id, event.target.checked)} /></td>
                  <th scope="row">{recipient.name}</th><td>{recipient.number ?? 'Not assigned'}</td><td>{recipient.email || 'No email available'}</td><td>{recipient.association ?? '—'}</td><td>{recipientStatus(recipient)}{!eligible ? ' · Not eligible to send' : ''}</td><td>{recipient.positions.join(', ') || '—'}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="compose-heading">
        <h2 id="compose-heading">Compose message</h2>
        <p><label htmlFor="template-select">Use a saved template</label><select id="template-select" value="" onChange={(event) => selectTemplate(event.target.value)}><option value="">Choose a template</option>{templates.filter((template) => template.audience === audience).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></p>
        <p><label htmlFor="subject">Subject</label><input id="subject" maxLength={200} value={subject} onChange={(event) => { setSubject(event.target.value); setPreviewRecipients(null); }} /></p>
        <p><label htmlFor="message-body">Message</label><textarea id="message-body" maxLength={5000} value={text} onChange={(event) => { setText(event.target.value); setPreviewRecipients(null); }} /></p>
        <p><label htmlFor="template-name">{editingTemplateId ? 'Edit template name' : 'Save current message as template'}</label><input id="template-name" maxLength={100} value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></p>
        <p><button type="button" className="button-secondary" disabled={busy || !templateName.trim() || !subject.trim() || !text.trim()} onClick={() => void saveTemplate()}>{editingTemplateId ? 'Update template' : 'Save template'}</button>{editingTemplateId ? <> <button type="button" className="button-secondary" disabled={busy} onClick={() => { setEditingTemplateId(null); setTemplateName(''); }}>Stop editing template</button></> : null}</p>
        {templates.filter((template) => template.audience === audience).length ? <ul aria-label="Saved templates">{templates.filter((template) => template.audience === audience).map((template) => <li key={template.id}>{template.name} <button type="button" className="button-secondary" disabled={busy} onClick={() => { setEditingTemplateId(template.id); setTemplateName(template.name); setSubject(template.subject); setText(template.body); }}>Edit template</button> <button type="button" className="button-secondary" disabled={busy} onClick={() => void removeTemplate(template)}>Delete template</button></li>)}</ul> : <p>No saved templates for this audience.</p>}
        <p><button type="button" disabled={busy || selectedIds.length === 0 || !subject.trim() || !text.trim()} onClick={() => void preview()}>{busy ? 'Working...' : 'Preview recipients'}</button></p>
      </section>

      {previewRecipients ? (
        <section className="message-confirmation" aria-labelledby="communication-preview-heading">
          <h2 id="communication-preview-heading">Review recipients</h2>
          <p>{previewRecipients.length} distinct email recipient{previewRecipients.length === 1 ? '' : 's'} will receive this message. Only paid, non-anonymized participant registrations or active association contacts are included.</p>
          <p><strong>{subject}</strong></p><p>{text}</p>
          {policyDocumentName ? <p>The event selection policy PDF, {policyDocumentName}, will be attached.</p> : null}
          <ul>{previewRecipients.map((recipient) => <li key={recipient.id}>{recipient.name} — Number {recipient.number ?? 'Not assigned'} — {recipient.email}</li>)}</ul>
          <p><button type="button" disabled={busy} onClick={() => void send()}>{busy ? 'Sending...' : `Send now to ${previewRecipients.length}`}</button></p>
          <fieldset className="form-group">
            <legend>Schedule this message</legend>
            <p><label htmlFor="scheduled-local">Send at (Australia/Melbourne)</label><input id="scheduled-local" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></p>
            <button type="button" className="button-secondary" disabled={busy || !scheduleAt} onClick={() => void schedule()}>Schedule email</button>
          </fieldset>
        </section>
      ) : null}

      <section aria-labelledby="scheduled-heading">
        <h2 id="scheduled-heading">Scheduled messages</h2>
        {scheduled.length === 0 ? <p>No messages scheduled.</p> : <ul>{scheduled.map((item) => (
          <li key={item.id}><strong>{item.subject}</strong> — {item.audience} — {item.recipientIds.length} selected — {new Date(item.scheduledAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })} Melbourne time — {item.status.toLowerCase()}
            {item.error ? <p>{item.error}</p> : null}
            {item.status === 'SCHEDULED' ? <button type="button" disabled={busy} onClick={() => void cancelScheduled(item)}>Cancel scheduled email</button> : null}
          </li>
        ))}</ul>}
      </section>

      <section aria-labelledby="delivery-history-heading">
        <h2 id="delivery-history-heading">Delivery history</h2>
        {deliveries.length === 0 ? <p>No messages sent for this event yet.</p> : <ul>{deliveries.map((entry) => (
          <li key={entry.id}>
            {entry.status === 'ANONYMIZED' ? 'Message details removed under retention policy' : entry.subject || '(no subject)'} — {deliveryStatus(entry)}
            {entry.status !== 'ANONYMIZED' ? <details><summary>Delivery details</summary><p>Recipient: {entry.to}</p><p>Created: <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></p>{entry.sentAt ? <p>Sent: <time dateTime={entry.sentAt}>{new Date(entry.sentAt).toLocaleString()}</time></p> : null}<pre>{entry.body}</pre></details> : null}
            {entry.status === 'FAILED' ? <button type="button" disabled={busy} onClick={() => void retryDelivery(entry)}>Retry this delivery</button> : null}
            {entry.status === 'AMBIGUOUS' ? <button type="button" disabled={busy} onClick={() => void retryDelivery(entry, true)}>Retry ambiguous delivery</button> : null}
          </li>
        ))}</ul>}
      </section>
    </section>
  );
}
