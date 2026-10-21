import { localDateTimeToUtc } from '../time/melbourne';
import { buildIcs } from './ics';

export function buildTrialCalendar(
  event: { name: string; eventDate: Date; gameStartTime: string; endTime: string; venue: string },
  uid: string,
  stamp = new Date(),
): string {
  return buildIcs({
    uid,
    title: `${event.name} trials`,
    start: localDateTimeToUtc(event.eventDate, event.gameStartTime),
    end: localDateTimeToUtc(event.eventDate, event.endTime),
    location: event.venue,
    description: 'Bring your QR code to check in. Your player Number will be issued at the door.',
    stamp,
  });
}
