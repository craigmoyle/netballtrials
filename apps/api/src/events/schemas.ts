import { defaultAgeRange } from '@netball-trials/types';
import { z } from 'zod';
import { isCalendarDate } from '../validation/date';

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
  };
});

export const eventPatchSchema = eventFieldsSchema.partial().extend({
  playMinutes: eventFieldsSchema.shape.playMinutes.unwrap().optional(),
  changeoverMinutes: eventFieldsSchema.shape.changeoverMinutes.unwrap().optional(),
  policyUrl: eventFieldsSchema.shape.policyUrl.nullable(),
}).strict();
export type EventInput = z.output<typeof eventInputSchema>;
export type EventPatch = z.infer<typeof eventPatchSchema>;

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
  gameStartTime: string;
}): string[] {
  const errors: string[] = [];
  const start = toMinutes(times.startTime);
  const gameStart = toMinutes(times.gameStartTime);
  const finish = toMinutes(times.endTime);

  if (start > gameStart) errors.push('gameStartTime');
  if (finish < gameStart) errors.push('endTime');

  return errors;
}
