const trialDateFormat = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'long',
  timeZone: 'Australia/Melbourne',
});

export function formatTrialDate(value: string): string {
  return trialDateFormat.format(new Date(value));
}
