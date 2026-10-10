export const CHECK_IN_UPDATED_EVENT = 'netball-check-in-updated';

export function notifyCheckInUpdated(): void {
  window.dispatchEvent(new Event(CHECK_IN_UPDATED_EVENT));
}
