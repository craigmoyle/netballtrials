import { ApiError } from '../api/client';

export function checkInSessionEnded(error: unknown, summaryRequest = false): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  // A 404 from undo identifies a missing registration, not a rejected session.
  if (summaryRequest) return error.status === 404 || error.status === 409;
  return error.status === 409 && error.message === 'check_in_closed';
}
