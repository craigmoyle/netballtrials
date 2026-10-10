import type { AuthUser, CheckInResult, CheckInSummary, EmailLogDTO, EventDTO, EventInput, LookupResult, MemberAssociationDTO, PlannerGapDTO, PublicEventDTO, RegistrationStatus, ReviewItemDTO, RoundPlanDTO, TicketDTO } from '@netball-trials/types';

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

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'request_failed', body?.fields);
  }

  return body as T;
}

async function planAction(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; plan: RoundPlanDTO } | { ok: false; gaps: PlannerGapDTO[] }> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
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
    logout: () => request<unknown>(baseUrl, '/api/auth/logout', { method: 'POST' }),
    listEvents: () => request<EventDTO[]>(baseUrl, '/api/admin/events'),
    getEvent: (id: string) => request<EventDTO>(baseUrl, `/api/admin/events/${id}`),
    createEvent: (input: EventInput) =>
      request<EventDTO>(baseUrl, '/api/admin/events', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateEvent: (id: string, patch: Partial<EventInput>) =>
      request<EventDTO>(baseUrl, `/api/admin/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    listAssociations: () => request<MemberAssociationDTO[]>(baseUrl, '/api/admin/associations'),
    listPublicAssociations: () => request<MemberAssociationDTO[]>(baseUrl, '/api/public/associations'),
    getPublicEvent: (id: string) =>
      request<PublicEventDTO>(baseUrl, `/api/public/events/${id}`),
    register: (id: string, input: Record<string, unknown>) =>
      request<{ status: 'received' }>(
        baseUrl,
        `/api/public/events/${id}/registrations`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
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
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    generatePlan: (eventId: string) =>
      planAction(baseUrl, `/api/admin/events/${eventId}/plan/generate`, { method: 'POST' }),
    publishPlan: (eventId: string) =>
      request<RoundPlanDTO>(baseUrl, `/api/admin/events/${eventId}/plan/publish`, {
        method: 'POST',
      }),
    regeneratePlan: (eventId: string, fromRound: number) =>
      planAction(baseUrl, `/api/admin/events/${eventId}/plan/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ fromRound }),
      }),
    getSheetsHtml: async (eventId: string) => {
      const response = await fetch(`${baseUrl}/api/admin/events/${eventId}/sheets`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new ApiError(response.status, 'request_failed');
      }
      return response.text();
    },
    listReview: (eventId: string) =>
      request<ReviewItemDTO[]>(baseUrl, `/api/admin/events/${eventId}/review`),
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
    sendMessage: async (eventId: string, message: { subject: string; text: string; batchId?: string }) => {
      const response = await fetch(`${baseUrl}/api/admin/events/${eventId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...message, batchId: message.batchId ?? crypto.randomUUID() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new ApiError(response.status, body?.error ?? 'request_failed');
      }
      return body as { sent: number; failed: number };
    },
    retryMessage: (eventId: string, batchId: string, deliveryIds: string[], includeAmbiguous = false) =>
      request<{ batchId: string; sent: number; failed: number; ambiguous: number; pending: number; deliveryIds: string[] }>(
        baseUrl,
        `/api/admin/events/${eventId}/messages/${batchId}/retry`,
        { method: 'POST', body: JSON.stringify({ deliveryIds, includeAmbiguous }) },
      ),
    listEmailLog: (eventId: string) =>
      request<EmailLogDTO[]>(baseUrl, `/api/admin/events/${eventId}/email-log`),
  };
}
