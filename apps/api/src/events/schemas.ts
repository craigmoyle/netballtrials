import { defaultAgeRange } from '@netball-trials/types';
import { z } from 'zod';
import { isCalendarDate } from '../validation/date';
import { clockMinutes, localDateTimeToUtc, melbourneLocalDateTimeToUtc } from '../time/melbourne';

export function registrationDeadlineToDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return melbourneLocalDateTimeToUtc(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !isCalendarDate(value.slice(0, 10))) {
    throw new Error('invalid registration deadline');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid registration deadline');
  return date;
}

const registrationDeadlineSchema = z.string().refine((value) => {
  try { registrationDeadlineToDate(value); return true; }
  catch { return false; }
}, 'must be a valid date and time in Australia/Melbourne');

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm');

const eventFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  competitionYear: z.number().int().min(2000).max(2100),
  division: z.string().trim().min(1).max(60),
  section: z.string().trim().min(1).max(40),
  eventDate: z.string().refine(isCalendarDate, 'must be a real YYYY-MM-DD date'),
  venue: z.string().trim().min(1).max(200),
  startTime: timeSchema,
  endTime: timeSchema,
  gameStartTime: timeSchema,
  registrationClosesAt: registrationDeadlineSchema,
  registrationFeeCents: z.number().int().min(0).max(100000),
  courts: z.number().int().min(1).max(12),
  rank1Min: z.number().int().min(0).max(20),
  rank2Min: z.number().int().min(0).max(20),
  rank3Min: z.number().int().min(0).max(20),
  playMinutes: z.number().int().min(1).max(60).default(8),
  changeoverMinutes: z.number().int().min(0).max(10).default(2),
  minAge: z.number().int().min(5).max(99).optional(),
  maxAge: z.number().int().min(5).max(99).optional(),
  policyUrl: z.url({ protocol: /^https?$/ }).max(500).optional(),
}).strict();

export const eventInputSchema = eventFieldsSchema.transform((input) => {
  const defaults = defaultAgeRange(input.division);
  return {
    ...input,
    minAge: input.minAge ?? defaults.minAge,
    maxAge: input.maxAge ?? defaults.maxAge,
    registrationClosesAt: registrationDeadlineToDate(input.registrationClosesAt),
  };
});

export const eventPatchSchema = eventFieldsSchema.partial().extend({
  playMinutes: eventFieldsSchema.shape.playMinutes.unwrap().optional(),
  changeoverMinutes: eventFieldsSchema.shape.changeoverMinutes.unwrap().optional(),
  policyUrl: eventFieldsSchema.shape.policyUrl.nullable(),
}).strict();
export const annualCloneInputSchema = z.object({
  competitionYear: eventFieldsSchema.shape.competitionYear,
  eventDate: eventFieldsSchema.shape.eventDate,
  registrationClosesAt: eventFieldsSchema.shape.registrationClosesAt,
}).strict().transform((input) => ({
  ...input,
  registrationClosesAt: registrationDeadlineToDate(input.registrationClosesAt),
}));

export type EventInput = z.input<typeof eventInputSchema>;
export type ValidEventInput = z.output<typeof eventInputSchema>;
export type EventPatch = z.infer<typeof eventPatchSchema>;
export type AnnualCloneInput = z.input<typeof annualCloneInputSchema>;
export type ValidAnnualCloneInput = z.output<typeof annualCloneInputSchema>;

export class EventValidationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Invalid event: ${fields.join(', ')}`);
    this.name = 'EventValidationError';
    this.fields = fields;
  }
}

export function validateWindow(times: {
  eventDate: string;
  startTime: string;
  endTime: string;
  gameStartTime: string;
  registrationClosesAt?: string | Date;
}): string[] {
  const errors: string[] = [];
  const start = clockMinutes(times.startTime);
  const gameStart = clockMinutes(times.gameStartTime);
  const finish = clockMinutes(times.endTime);
  if (times.registrationClosesAt) {
    const registrationClosesAt = typeof times.registrationClosesAt === 'string'
      ? registrationDeadlineToDate(times.registrationClosesAt)
      : times.registrationClosesAt;
    try {
      if (registrationClosesAt > localDateTimeToUtc(new Date(`${times.eventDate}T00:00:00.000Z`), times.startTime)) {
        errors.push('registrationClosesAt');
      }
    } catch {
      errors.push('startTime');
    }
  }
  if (start > gameStart) errors.push('gameStartTime');
  if (finish < gameStart) errors.push('endTime');

  const eventDate = new Date(`${times.eventDate}T00:00:00.000Z`);
  for (const field of ['startTime', 'gameStartTime', 'endTime'] as const) {
    try { localDateTimeToUtc(eventDate, times[field]); }
    catch { errors.push(field); }
  }
  return errors;
}
