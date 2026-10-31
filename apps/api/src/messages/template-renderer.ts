import type { CommunicationAudience } from './communications';

const TEMPLATE_FIELDS: Record<CommunicationAudience, string[]> = {
  participants: [
    'playerFirstName', 'playerLastName', 'playerName', 'playerNames', 'playerNumber',
    'parentName', 'associationName', 'eventName', 'eventDate', 'arrivalTime', 'startTime',
    'venue',
  ],
  associations: ['associationName', 'contactName', 'eventName', 'eventDate', 'arrivalTime', 'startTime', 'venue', 'eventList'],
};

const PLACEHOLDER_PATTERN = /{{\s*([^{}]*?)\s*}}/g;

export function templateFields(audience: CommunicationAudience): string[] {
  return [...TEMPLATE_FIELDS[audience]];
}

export function unsupportedTemplateFields(audience: CommunicationAudience, ...values: string[]): string[] {
  const allowed = new Set(TEMPLATE_FIELDS[audience]);
  const found = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
      const field = match[1].trim();
      if (!allowed.has(field)) found.add(field);
    }
  }
  return [...found];
}

export function renderEmailTemplate(value: string, fields: Record<string, string>): string {
  return value.replace(PLACEHOLDER_PATTERN, (_token, name: string) => fields[name.trim()] ?? '');
}
