import type { AuthUser, CheckInResult, CheckInSummary, EventDTO, EventInput, LookupResult, MemberAssociationDTO, PublicEventDTO, RegistrationStatus, TicketDTO } from '@netball-trials/types';

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
    getPublicEvent: (id: string) =>
      request<PublicEventDTO>(baseUrl, `/api/public/events/${id}`),
    register: (id: string, input: Record<string, unknown>) =>
      request<{ registrationId: string; checkoutUrl: string }>(
        baseUrl,
        `/api/public/events/${id}/registrations`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    getRegistrationStatus: (id: string) =>
      request<{ status: RegistrationStatus }>(baseUrl, `/api/public/registrations/${id}`),
    getTicket: (token: string) =>
      request<TicketDTO>(baseUrl, `/api/public/ticket/${token}`),
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
  };
}
