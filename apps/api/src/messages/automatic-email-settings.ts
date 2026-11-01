import type { PrismaClient } from '@prisma/client';
import type { AutomaticEmailSettingsDTO } from '@netball-trials/types';

export const DEFAULT_AUTOMATIC_EMAIL_SETTINGS: Omit<AutomaticEmailSettingsDTO, 'updatedAt'> = {
  confirmationSubject: 'Trial registration confirmed: {{playerName}} ({{eventName}})',
  confirmationBody: '{{playerName}} is registered for {{eventName}}.\nWhen: {{eventDate}} at {{gameStartTime}}\nWhere: {{venue}}',
  reminderSubject: 'Reminder: {{eventName}}',
  reminderBody: '{{eventName}} is at {{venue}} on {{eventDate}} at {{startTime}}. See you there.',
  reminderLeadHours: 24,
};

const TOKENS: Record<keyof Omit<AutomaticEmailSettingsDTO, 'updatedAt' | 'reminderLeadHours'>, { allowed: string[]; required: string[] }> = {
  confirmationSubject: { allowed: ['playerName', 'eventName'], required: [] },
  confirmationBody: { allowed: ['playerName', 'eventName', 'eventDate', 'gameStartTime', 'venue'], required: ['playerName', 'eventName', 'eventDate', 'gameStartTime', 'venue'] },
  reminderSubject: { allowed: ['eventName'], required: [] },
  reminderBody: { allowed: ['eventName', 'venue', 'eventDate', 'startTime'], required: ['eventName', 'venue', 'eventDate', 'startTime'] },
};
const TOKEN_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g;

type TemplateField = keyof typeof TOKENS;
type TemplateInput = Pick<AutomaticEmailSettingsDTO, TemplateField> & { reminderLeadHours: number };

export function validateAutomaticEmailTemplates(input: TemplateInput): string[] {
  const invalidFields: string[] = [];
  for (const field of Object.keys(TOKENS) as TemplateField[]) {
    const value = input[field];
    const matches = [...value.matchAll(TOKEN_PATTERN)];
    const remaining = value.replace(TOKEN_PATTERN, '');
    const invalidToken = matches.some((match) => !TOKENS[field].allowed.includes(match[1]!)) || remaining.includes('{{') || remaining.includes('}}');
    const missingRequired = TOKENS[field].required.some((token) => !matches.some((match) => match[1] === token));
    if (invalidToken || missingRequired) invalidFields.push(field);
  }
  if (!Number.isInteger(input.reminderLeadHours) || input.reminderLeadHours < 1 || input.reminderLeadHours > 168) invalidFields.push('reminderLeadHours');
  return invalidFields;
}

export function renderAutomaticEmailTemplate(template: string, values: Record<string, string>): string {
  return template.replace(TOKEN_PATTERN, (_match, token: string) => values[token] ?? '');
}

export function renderAutomaticEmailSubject(template: string, values: Record<string, string>): string {
  return renderAutomaticEmailTemplate(template, values).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

export async function getAutomaticEmailSettings(prisma: PrismaClient): Promise<AutomaticEmailSettingsDTO> {
  const settings = await prisma.automaticEmailSettings.findUnique({ where: { id: 'automatic' } });
  if (!settings) return { ...DEFAULT_AUTOMATIC_EMAIL_SETTINGS, updatedAt: null };
  return { ...settings, updatedAt: settings.updatedAt.toISOString() };
}

export async function saveAutomaticEmailSettings(prisma: PrismaClient, input: TemplateInput): Promise<AutomaticEmailSettingsDTO> {
  const settings = await prisma.automaticEmailSettings.upsert({
    where: { id: 'automatic' },
    create: { id: 'automatic', ...input },
    update: input,
  });
  return { ...settings, updatedAt: settings.updatedAt.toISOString() };
}
