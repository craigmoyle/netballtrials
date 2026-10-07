import type { AuthUser, EventDTO, EventInput, MemberAssociationDTO } from '@netball-trials/types';

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
  };
}
