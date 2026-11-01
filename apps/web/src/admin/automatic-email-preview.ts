import type { AutomaticEmailSettingsDTO } from '@netball-trials/types';

const SAMPLE_VALUES = {
  playerName: 'Sample Player',
  eventName: 'Sample Trials',
  eventDate: '12 September 2027',
  venue: 'Sample venue',
  gameStartTime: '9:00am',
  startTime: '8:30am',
};

export function previewAutomaticEmailTemplate(template: string): string {
  return template.replace(/{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g, (match, token: string) =>
    SAMPLE_VALUES[token as keyof typeof SAMPLE_VALUES] ?? match,
  );
}

export function emailPreview(settings: AutomaticEmailSettingsDTO, kind: 'confirmation' | 'reminder') {
  const subject = kind === 'confirmation' ? settings.confirmationSubject : settings.reminderSubject;
  const body = kind === 'confirmation' ? settings.confirmationBody : settings.reminderBody;
  return { subject: previewAutomaticEmailTemplate(subject), body: previewAutomaticEmailTemplate(body) };
}
