const MELBOURNE = 'Australia/Melbourne';

export function melbourneDateTimeInput(iso: string): string {
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MELBOURNE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function localToInstant(value: string): Date {
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MELBOURNE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const valueFor = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const localAsUtc = Date.UTC(valueFor('year'), valueFor('month') - 1, valueFor('day'), valueFor('hour'), valueFor('minute'), valueFor('second'));
    const next = wall - (localAsUtc - instant);
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export function defaultRegistrationDeadline(eventDate: string, startTime: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !/^\d{2}:\d{2}$/.test(startTime)) return '';
  return melbourneDateTimeInput(new Date(localToInstant(`${eventDate}T${startTime}`).getTime() - 86_400_000).toISOString());
}
