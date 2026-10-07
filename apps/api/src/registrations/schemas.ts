import { z } from 'zod';

export const positionSchema = z.enum(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
export type RegistrationPosition = z.infer<typeof positionSchema>;

function positionsAreDistinct(data: {
  rank1Position: string;
  rank2Position?: string;
  rank3Position?: string;
}): boolean {
  const chosen = [data.rank1Position, data.rank2Position, data.rank3Position].filter(
    (value): value is string => Boolean(value),
  );
  return new Set(chosen).size === chosen.length;
}

export const registrationInputSchema = z
  .object({
    playerFirstName: z.string().trim().min(1).max(80),
    playerLastName: z.string().trim().min(1).max(80),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    parentName: z.string().trim().min(1).max(120),
    parentEmail: z
      .email()
      .max(320)
      .transform((value) => value.trim().toLowerCase()),
    parentMobile: z
      .string()
      .trim()
      .regex(/^[0-9 +()-]{6,20}$/, 'must be a contactable phone number'),
    memberAssociation: z.string().trim().min(1).max(80),
    rank1Position: positionSchema,
    rank2Position: positionSchema.optional(),
    rank3Position: positionSchema.optional(),
    optInExtraPositions: z.boolean().default(false),
    eligibilityConfirmed: z.literal(true),
  })
  .refine(positionsAreDistinct, {
    message: 'positions must be distinct',
    path: ['rank2Position'],
  });

export type RegistrationInput = z.input<typeof registrationInputSchema>;
export type RegistrationValues = z.output<typeof registrationInputSchema>;
