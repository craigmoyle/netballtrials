function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - instant.getTime();
}

export function localDateTimeToUtc(date: Date, clock: string, timeZone = 'Australia/Melbourne'): Date {
  const [year, month, day] = date.toISOString().slice(0, 10).split('-').map(Number);
  const [hour, minute] = clock.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite) || hour > 23 || minute > 59) {
    throw new Error('invalid local date/time');
  }

  const wallTimeAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = wallTimeAsUtc;
  // Recompute the zone offset after shifting the candidate so dates on a DST
  // transition resolve against the offset at the actual local instant.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = wallTimeAsUtc - zoneOffsetMs(new Date(candidate), timeZone);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}
