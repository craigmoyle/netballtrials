import type { AuthUser, BibColorDTO, CheckInResult, CheckInSummary, CommunicationRecipientDTO, EmailLogDTO, EmailTemplateDTO, EventCourtColorDTO, EventDTO, EventInput, GamePlayerDTO, IncompleteRegistrationDTO, LookupResult, ManualRoundInputDTO, ManualSuffixInputDTO, MemberAssociationDTO, ParentCheckoutDTO, ParentRegistrationDTO, ParentRegistrationUpdateDTO, PublicAssociationDTO, PlayerHistoryEntryDTO, PlanRevisionSummaryDTO, PlannerGapDTO, PublicEventDTO, RegistrationStatus, ReviewItemDTO, RosterDTO, RoundPlanDTO, PlannerPreviewDTO, PublicTrialDTO, RegistrationChangeDTO, ScheduledMessageDTO, TicketDTO } from '@netball-trials/types';

export class ApiError extends Error {
  readonly status: number;
  readonly fields?: string[];

  constructor(status: number, message: string, fields?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

async function fetchResponse(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  try {
    return await fetch(`${baseUrl}${path}`, { credentials: 'include', ...init, headers });
  } catch {
    throw new ApiError(0, 'network_error');
  }
}

// Returns null for an empty body and undefined when the body is not JSON
// (e.g. an HTML error page from a proxy).
async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetchResponse(baseUrl, path, init);
  const body = await readJson(response);

  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'request_failed', body?.fields);
  }
  if (body === undefined) throw new ApiError(response.status, 'invalid_json');

  return body as T;
}

async function requestHtml(baseUrl: string, path: string): Promise<string> {
  const response = await fetchResponse(baseUrl, path);
  const text = await response.text();
  if (!response.ok) {
    let message = 'request_failed';
    try { message = JSON.parse(text)?.error ?? message; } catch { /* retain the generic error for non-JSON responses */ }
    throw new ApiError(response.status, message);
  }
  return text;
}

type ManualRoundResult =
  | { ok: true; plan: RoundPlanDTO }
  | { ok: false; reason: 'invalid_plan'; errors: PlannerGapDTO[] }
  | { ok: false; reason: 'warnings_required'; warnings: PlannerGapDTO[] };

async function manualPlanAction(baseUrl: string, path: string, input: ManualRoundInputDTO | ManualSuffixInputDTO): Promise<ManualRoundResult> {
  const response = await fetchResponse(baseUrl, path, { method: 'POST', body: JSON.stringify(input) });
  const body = await readJson(response);
  if (response.status === 422 && body?.error === 'invalid_plan') {
    return { ok: false, reason: 'invalid_plan', errors: (body.errors ?? []) as PlannerGapDTO[] };
  }
  if (response.status === 422 && body?.error === 'warnings_require_confirmation') {
    return { ok: false, reason: 'warnings_required', warnings: (body.warnings ?? []) as PlannerGapDTO[] };
  }
  if (!response.ok) throw new ApiError(response.status, body?.error ?? 'request_failed');
  return { ok: true, plan: body as RoundPlanDTO };
}

async function manualRoundAction(baseUrl: string, eventId: string, round: number, input: ManualRoundInputDTO): Promise<ManualRoundResult> {
  return manualPlanAction(baseUrl, `/api/admin/events/${eventId}/plan/rounds/${round}/manual`, input);
}

async function planAction(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; plan: RoundPlanDTO } | { ok: false; gaps: PlannerGapDTO[] }> {
  const response = await fetchResponse(baseUrl, path, init);
  const body = await readJson(response);
  if (response.status === 422) {
    return { ok: false, gaps: (body?.gaps ?? []) as PlannerGapDTO[] };
  }
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'request_failed');
  }
  return { ok: true, plan: body as RoundPlanDTO };
}

export function apiClient(baseUrl: string) {
  return {
    requestParentAccessLink: (email: string) =>
      request<{ status: string }>(baseUrl, '/api/public/parent-access/request-link', { method: 'POST', body: JSON.stringify({ email }) }),
    verifyParentAccessToken: (token: string) =>
      request<{ status: 'signed_in' }>(baseUrl, '/api/public/parent-access/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    listParentRegistrations: () => request<ParentRegistrationDTO[]>(baseUrl, '/api/parent/registrations'),
    logoutParent: () => request<unknown>(baseUrl, '/api/parent/logout', { method: 'POST' }),
    updateParentRegistration: (id: string, patch: ParentRegistrationUpdateDTO) =>
      request<ParentRegistrationDTO>(baseUrl, `/api/parent/registrations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    withdrawParentRegistration: (id: string) =>
      request<ParentRegistrationDTO>(baseUrl, `/api/parent/registrations/${id}/withdraw`, { method: 'POST' }),
    continueParentCheckout: (id: string) =>
      request<ParentCheckoutDTO>(baseUrl, `/api/parent/registrations/${id}/checkout`, { method: 'POST' }),
    requestParentEmailChange: (email: string) =>
      request<{ status: 'sent' }>(baseUrl, '/api/parent/email-change', { method: 'POST', body: JSON.stringify({ email }) }),
    confirmParentEmailChange: (token: string) =>
      request<{ status: 'email_updated'; email: string }>(baseUrl, '/api/parent/email-change/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
    listIncompleteRegistrations: (eventId: string) =>
      request<IncompleteRegistrationDTO[]>(baseUrl, `/api/admin/events/${eventId}/incomplete-registrations`),
    getRegistrationChanges: (eventId: string, registrationId: string) =>
      request<RegistrationChangeDTO[]>(baseUrl, `/api/admin/events/${eventId}/registrations/${registrationId}/changes`),
    requestIncompleteRegistrationEmailCorrection: (eventId: string, registrationId: string, email: string, familyConfirmed: true) =>
      request<{ status: 'sent' }>(baseUrl, `/api/admin/events/${eventId}/incomplete-registrations/${registrationId}/email-correction`, { method: 'POST', body: JSON.stringify({ email, familyConfirmed }) }),
    sendIncompleteRegistrationReminder: (eventId: string, registrationId: string) =>
      request<{ status: 'sent' }>(baseUrl, `/api/admin/events/${eventId}/incomplete-registrations/${registrationId}/reminder`, { method: 'POST' }),
    requestLink: (email: string) =>
      request<{ status: string }>(baseUrl, '/api/auth/request-link', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    verify: (token: string) =>
      request<{ status: string }>(baseUrl, '/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    me: () => request<{ user: AuthUser }>(baseUrl, '/api/auth/me'),
    inviteStaff: (email: string) => request<{ status: string }>(baseUrl, '/api/admin/staff/invites', { method: 'POST', body: JSON.stringify({ email }) }),
    logout: () => request<unknown>(baseUrl, '/api/auth/logout', { method: 'POST' }),
    listEvents: () => request<EventDTO[]>(baseUrl, '/api/admin/events'),
    searchPlayerHistory: (playerName: string, dateOfBirth: string) =>
      request<PlayerHistoryEntryDTO[]>(baseUrl, `/api/admin/player-history?playerName=${encodeURIComponent(playerName)}&dateOfBirth=${encodeURIComponent(dateOfBirth)}`),
    getEvent: (id: string) => request<EventDTO>(baseUrl, `/api/admin/events/${id}`),
    createEvent: (input: EventInput) =>
      request<EventDTO>(baseUrl, '/api/admin/events', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateEvent: (id: string, patch: Omit<Partial<EventInput>, 'policyUrl'> & { policyUrl?: string | null }) =>
      request<EventDTO>(baseUrl, `/api/admin/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    uploadPolicyDocument: (id: string, input: { fileName: string; pdfBase64: string }) =>
      request<{ policyDocumentName: string; policyUrl: string }>(baseUrl, `/api/admin/events/${id}/policy-document`, { method: 'PUT', body: JSON.stringify(input) }),
    deletePolicyDocument: (id: string) => request<unknown>(baseUrl, `/api/admin/events/${id}/policy-document`, { method: 'DELETE' }),
    openEvent: (id: string) => request<EventDTO>(baseUrl, `/api/admin/events/${id}/open`, { method: 'POST' }),
    closeEvent: (id: string) => request<EventDTO>(baseUrl, `/api/admin/events/${id}/close`, { method: 'POST' }),
    deleteEvent: (id: string) => request<unknown>(baseUrl, `/api/admin/events/${id}`, { method: 'DELETE' }),
    checkInSettings: (id: string) => request<{ pinConfigured: boolean; checkInClosedAt: string | null }>(baseUrl, `/api/admin/events/${id}/check-in-settings`),
    setCheckInPin: (id: string, pin: string) => request<unknown>(baseUrl, `/api/admin/events/${id}/check-in-pin`, { method: 'PUT', body: JSON.stringify({ pin }) }),
    clearCheckInPin: (id: string) => request<unknown>(baseUrl, `/api/admin/events/${id}/check-in-pin`, { method: 'DELETE' }),
    closeCheckIn: (id: string) => request<unknown>(baseUrl, `/api/admin/events/${id}/check-in/close`, { method: 'POST' }),
    getRoster: (id: string) => request<RosterDTO>(baseUrl, `/api/admin/events/${id}/roster`),
    downloadRoster: async (id: string) => {
      const response = await fetchResponse(baseUrl, `/api/admin/events/${id}/roster/export`);
      if (!response.ok) {
        const body = await readJson(response);
        throw new ApiError(response.status, body?.error ?? 'request_failed');
      }
      return response.blob();
    },
    listAssociations: () => request<MemberAssociationDTO[]>(baseUrl, '/api/admin/associations'),
    listBibColors: () => request<BibColorDTO[]>(baseUrl, '/api/admin/bib-colors'),
    createBibColor: (input: { name: string; hex: string }) =>
      request<BibColorDTO>(baseUrl, '/api/admin/bib-colors', { method: 'POST', body: JSON.stringify(input) }),
    updateBibColor: (id: string, patch: { name?: string; hex?: string }) =>
      request<BibColorDTO>(baseUrl, `/api/admin/bib-colors/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    archiveBibColor: (id: string) => request<unknown>(baseUrl, `/api/admin/bib-colors/${id}`, { method: 'DELETE' }),
    getCourtColors: (eventId: string) => request<EventCourtColorDTO[]>(baseUrl, `/api/admin/events/${eventId}/court-colors`),
    setCourtColors: (eventId: string, court: number, pair: { teamAColorId: string; teamBColorId: string }) =>
      request<EventCourtColorDTO>(baseUrl, `/api/admin/events/${eventId}/court-colors/${court}`, { method: 'PUT', body: JSON.stringify(pair) }),

    createAssociation: (input: { name: string; primaryContactName?: string | null; primaryContactEmail?: string | null }) => request<MemberAssociationDTO>(baseUrl, '/api/admin/associations', { method: 'POST', body: JSON.stringify(input) }),
    updateAssociation: (id: string, patch: { active?: boolean; primaryContactName?: string | null; primaryContactEmail?: string | null }) => request<MemberAssociationDTO>(baseUrl, `/api/admin/associations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    setAssociationActive: (id: string, active: boolean) => request<MemberAssociationDTO>(baseUrl, `/api/admin/associations/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
    listPublicAssociations: () => request<PublicAssociationDTO[]>(baseUrl, '/api/public/associations'),
    listPublicEvents: () => request<PublicTrialDTO[]>(baseUrl, '/api/public/events'),
    getPublicEvent: (id: string) =>
      request<PublicEventDTO>(baseUrl, `/api/public/events/${id}`),
    register: (id: string, input: Record<string, unknown>) =>
      request<{ status: 'received' }>(
        baseUrl,
        `/api/public/events/${id}/registrations`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    completeFakePayment: (simulationToken: string) =>
      request<{ status: 'paid' | 'not_completed' }>(baseUrl, '/api/public/fake-checkouts/complete', {
        method: 'POST',
        body: JSON.stringify({ simulationToken }),
      }),
    dayOfRegistration: (id: string, input: Record<string, unknown>) =>
      request<{ status: 'received'; nextStep: 'verify-email' | 'checkout' }>(baseUrl, `/api/admin/events/${id}/day-of-registration`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    getRegistrationStatus: (sessionId: string) =>
      request<{
        status: RegistrationStatus;
        ticketPath?: string;
        calendarUrl?: string;
        ticket?: TicketDTO | null;
      }>(baseUrl, `/api/public/checkout-sessions/${sessionId}/status`),
    getTicket: (token: string) =>
      request<TicketDTO>(baseUrl, `/api/public/ticket/${encodeURIComponent(token)}`),
    ticketCalendarUrl: (token: string) => `${baseUrl}/api/public/ticket/${encodeURIComponent(token)}/calendar`,
    openAdminCheckIn: (eventId: string) =>
      request<{ eventName: string }>(baseUrl, `/api/admin/events/${eventId}/check-in/session`, { method: 'POST' }),
    openCheckIn: (eventId: string, pin: string) =>
      request<{ eventName: string }>(baseUrl, '/api/check-in/session', {
        method: 'POST',
        body: JSON.stringify({ eventId, pin }),
      }),
    checkInSummary: () => request<CheckInSummary>(baseUrl, '/api/check-in/session'),
    lookup: (query: string) =>
      request<LookupResult[]>(baseUrl, `/api/check-in/lookup?q=${encodeURIComponent(query)}`),
    scan: (token: string) =>
      request<CheckInResult>(baseUrl, '/api/check-in/scan', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    manualCheckIn: (id: string) =>
      request<CheckInResult>(baseUrl, `/api/check-in/registrations/${id}`, { method: 'POST' }),
    undoCheckIn: (id: string) =>
      request<unknown>(baseUrl, `/api/check-in/registrations/${id}/undo`, { method: 'POST' }),
    getPlan: async (eventId: string) => {
      try {
        return await request<RoundPlanDTO>(baseUrl, `/api/admin/events/${eventId}/plan`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    getPublishedPlan: async (eventId: string) => {
      try {
        return await request<RoundPlanDTO>(baseUrl, `/api/admin/events/${eventId}/plan?published=true`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    getPlanPreview: (eventId: string) => request<PlannerPreviewDTO>(baseUrl, `/api/admin/events/${eventId}/plan/preview`),
    getPlanRevisions: (eventId: string) => request<PlanRevisionSummaryDTO[]>(baseUrl, `/api/admin/events/${eventId}/plan/revisions`),
    getPlanRevision: (eventId: string, planId: string) => request<RoundPlanDTO>(baseUrl, `/api/admin/events/${eventId}/plan/revisions/${planId}`),
    getGameRoster: (eventId: string) => request<GamePlayerDTO[]>(baseUrl, `/api/admin/events/${eventId}/game-roster`),
    saveManualRound: (eventId: string, round: number, input: ManualRoundInputDTO) => manualRoundAction(baseUrl, eventId, round, input),
    generatePlan: (eventId: string) =>
      planAction(baseUrl, `/api/admin/events/${eventId}/plan/generate`, { method: 'POST' }),
    publishPlan: (eventId: string, planId: string) =>
      planAction(baseUrl, `/api/admin/events/${eventId}/plan/publish`, { method: 'POST', body: JSON.stringify({ planId }) }),
    regeneratePlan: (eventId: string, fromRound: number, sourcePlanId: string, removedRegistrationIds?: string[]) =>
      planAction(baseUrl, `/api/admin/events/${eventId}/plan/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ fromRound, sourcePlanId, ...(removedRegistrationIds ? { removedRegistrationIds } : {}) }),
      }),
    saveManualSuffix: (eventId: string, input: ManualSuffixInputDTO) =>
      manualPlanAction(baseUrl, `/api/admin/events/${eventId}/plan/suffix/manual`, input),
    getSheetsHtml: (eventId: string) => requestHtml(baseUrl, `/api/admin/events/${eventId}/sheets`),
    getBlankSheetHtml: (eventId: string) => requestHtml(baseUrl, `/api/admin/events/${eventId}/sheets/blank`),
    listReview: (eventId: string, includeResolved = false) =>
      request<ReviewItemDTO[]>(baseUrl, `/api/admin/events/${eventId}/review${includeResolved ? '?includeResolved=true' : ''}`),
    resolveReview: (eventId: string, itemId: string, note: string) =>
      request<ReviewItemDTO>(baseUrl, `/api/admin/events/${eventId}/review/${itemId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    withdrawRegistration: (eventId: string, registrationId: string) =>
      request<{ id: string; status: string }>(
        baseUrl,
        `/api/admin/events/${eventId}/registrations/${registrationId}/withdraw`,
        { method: 'POST' },
      ),
    getMessageRecipientCount: (eventId: string) => request<{ count: number }>(baseUrl, `/api/admin/events/${eventId}/message-recipients`),
    sendMessage: async (eventId: string, message: { subject: string; text: string; batchId?: string }) => {
      const response = await fetchResponse(baseUrl, `/api/admin/events/${eventId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ ...message, batchId: message.batchId ?? crypto.randomUUID() }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new ApiError(response.status, body?.error ?? 'request_failed');
      }
      return body as { batchId: string; sent: number; failed: number; ambiguous: number; pending: number; deliveryIds: string[]; sentThisRun: number; failedThisRun: number; ambiguousThisRun: number };
    },
    retryMessage: (eventId: string, batchId: string, deliveryIds: string[], includeAmbiguous = false) =>
      request<{ batchId: string; sent: number; failed: number; ambiguous: number; pending: number; deliveryIds: string[] }>(
        baseUrl,
        `/api/admin/events/${eventId}/messages/${batchId}/retry`,
        { method: 'POST', body: JSON.stringify({ deliveryIds, includeAmbiguous }) },
      ),
    listEmailLog: (eventId: string) =>
      request<EmailLogDTO[]>(baseUrl, `/api/admin/events/${eventId}/email-log`),
    getCommunicationRecipients: (eventId: string) =>
      request<{ participants: CommunicationRecipientDTO[]; associations: CommunicationRecipientDTO[] }>(baseUrl, `/api/admin/events/${eventId}/communications/recipients`),
    previewCommunication: (eventId: string, input: { audience: 'participants' | 'associations'; recipientIds: string[] }) =>
      request<{ count: number; recipients: CommunicationRecipientDTO[] }>(baseUrl, `/api/admin/events/${eventId}/communications/preview`, { method: 'POST', body: JSON.stringify(input) }),
    sendCommunication: (eventId: string, input: { audience: 'participants' | 'associations'; recipientIds: string[]; subject: string; text: string; batchId?: string }) =>
      request<{ batchId: string; sent: number; failed: number; ambiguous: number; pending: number; deliveryIds: string[] }>(baseUrl, `/api/admin/events/${eventId}/communications/send`, { method: 'POST', body: JSON.stringify(input) }),
    listCommunicationTemplates: () => request<EmailTemplateDTO[]>(baseUrl, '/api/admin/communications/templates'),
    saveCommunicationTemplate: (input: { name: string; audience: 'participants' | 'associations'; subject: string; body: string }) =>
      request<EmailTemplateDTO>(baseUrl, '/api/admin/communications/templates', { method: 'POST', body: JSON.stringify(input) }),
    updateCommunicationTemplate: (id: string, input: { name: string; audience: 'participants' | 'associations'; subject: string; body: string }) =>
      request<EmailTemplateDTO>(baseUrl, `/api/admin/communications/templates/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    deleteCommunicationTemplate: (templateId: string) => request<unknown>(baseUrl, `/api/admin/communications/templates/${templateId}`, { method: 'DELETE' }),
    listScheduledCommunications: (eventId: string) => request<ScheduledMessageDTO[]>(baseUrl, `/api/admin/events/${eventId}/communications/scheduled`),
    scheduleCommunication: (eventId: string, input: { audience: 'participants' | 'associations'; recipientIds: string[]; subject: string; text: string; scheduledLocal: string }) =>
      request<ScheduledMessageDTO>(baseUrl, `/api/admin/events/${eventId}/communications/schedule`, { method: 'POST', body: JSON.stringify(input) }),
    cancelScheduledCommunication: (eventId: string, id: string) => request<{ status: string }>(baseUrl, `/api/admin/events/${eventId}/communications/scheduled/${id}/cancel`, { method: 'POST' }),
    listCommunicationDeliveries: (eventId: string) => request<EmailLogDTO[]>(baseUrl, `/api/admin/events/${eventId}/communications/deliveries`),
    retryCommunication: (eventId: string, batchId: string, deliveryIds: string[], includeAmbiguous = false) =>
      request<{ batchId: string; sent: number; failed: number; ambiguous: number; pending: number }>(baseUrl, `/api/admin/events/${eventId}/communications/${batchId}/retry`, { method: 'POST', body: JSON.stringify({ deliveryIds, includeAmbiguous }) }),
  };
}

export type ApiClient = ReturnType<typeof apiClient>;
