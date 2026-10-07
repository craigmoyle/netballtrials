import { z } from 'zod';

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm');

export const eventInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  competitionYear: z.number().int().min(2000).max(2100),
  division: z.string().trim().min(1).max(60),
  section: z.string().trim().min(1).max(40),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  venue: z.string().trim().min(1).max(200),
  startTime: timeSchema,
  endTime: timeSchema,
  firstWhistle: timeSchema,
  lastWhistle: timeSchema,
  registrationFeeCents: z.number().int().min(0).max(100000),
  courts: z.number().int().min(1).max(12),
  rank1Min: z.number().int().min(0).max(20),
  rank2Min: z.number().int().min(0).max(20),
  rank3Min: z.number().int().min(0).max(20),
  playMinutes: z.number().int().min(1).max(60).default(8),
  changeoverMinutes: z.number().int().min(0).max(10).default(2),
  minAge: z.number().int().min(5).max(99).default(5),
  maxAge: z.number().int().min(5).max(99).default(99),
  policyUrl: z.url().max(500).optional(),
});

export type EventInput = z.output<typeof eventInputSchema>;
export type EventPatch = z.infer<typeof eventPatchSchema>;

export const eventPatchSchema = eventInputSchema.partial();

export class EventValidationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Invalid event: ${fields.join(', ')}`);
    this.name = 'EventValidationError';
    this.fields = fields;
  }
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function validateWindow(times: {
  startTime: string;
  endTime: string;
  firstWhistle: string;
  lastWhistle: string;
}): string[] {
  const errors: string[] = [];
  const start = toMinutes(times.startTime);
  const first = toMinutes(times.firstWhistle);
  const last = toMinutes(times.lastWhistle);
  const end = toMinutes(times.endTime);

  if (start > first) errors.push('firstWhistle');
  if (first >= last) errors.push('lastWhistle');
  if (last > end) errors.push('endTime');

  return errors;
}
