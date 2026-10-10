import { Prisma, type PrismaClient, type Registration } from '@prisma/client';
import { ageAtDecember31, isAgeInRange, normalizePlayerName } from './eligibility';
import { DEFAULT_POLICY_URL } from '../policy';
import { registrationInputSchema, type RegistrationInput } from './schemas';

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export class RegistrationValidationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Invalid registration: ${fields.join(', ')}`);
    this.name = 'RegistrationValidationError';
    this.fields = fields;
  }
}

export class RegistrationConflictError extends Error {
  readonly reason: 'duplicate' | 'closed';
  readonly existing: Registration | null;

  constructor(reason: 'duplicate' | 'closed', existing: Registration | null = null) {
    super(reason);
    this.name = 'RegistrationConflictError';
    this.reason = reason;
    this.existing = existing;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

export async function expireStalePending(
  prisma: PrismaClient,
  eventId: string,
  now: Date,
): Promise<number> {
  const result = await prisma.registration.updateMany({
    where: { eventId, status: 'PENDING', expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

export async function createPendingRegistration(
  prisma: PrismaClient,
  eventId: string,
  input: RegistrationInput,
  now: Date,
): Promise<Registration> {
  const parsed = registrationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RegistrationValidationError(
      parsed.error.issues.map((issue) => String(issue.path[0])),
    );
  }
  const values = parsed.data;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== 'OPEN') {
    throw new RegistrationConflictError('closed');
  }
  const association = await prisma.memberAssociation.findFirst({
    where: { name: values.memberAssociation, active: true },
    select: { id: true },
  });
  if (!association) {
    throw new RegistrationValidationError(['memberAssociation']);
  }

  await expireStalePending(prisma, eventId, now);

  const dateOfBirth = new Date(`${values.dateOfBirth}T00:00:00.000Z`);
  if (dateOfBirth.getTime() > now.getTime()) {
    throw new RegistrationValidationError(['dateOfBirth']);
  }
  const age = ageAtDecember31(dateOfBirth, event.competitionYear);
  const ageFlagged = !isAgeInRange(age, event.minAge, event.maxAge);
  const playerNameNormalized = normalizePlayerName(values.playerFirstName, values.playerLastName);
  const duplicateWhere: Prisma.RegistrationWhereInput = {
    eventId,
    playerNameNormalized,
    dateOfBirth,
    status: { in: ['PENDING', 'PAID'] },
  };
  const existing = await prisma.registration.findFirst({ where: duplicateWhere });
  if (existing) {
    throw new RegistrationConflictError('duplicate', existing);
  }

  try {
    return await prisma.registration.create({
      data: {
        eventId,
        playerFirstName: values.playerFirstName,
        playerLastName: values.playerLastName,
        playerNameNormalized,
        dateOfBirth,
        parentName: values.parentName,
        parentEmail: values.parentEmail,
        parentMobile: values.parentMobile,
        memberAssociation: values.memberAssociation,
        rank1Position: values.rank1Position,
        rank2Position: values.rank2Position ?? null,
        rank3Position: values.rank3Position ?? null,
        optInExtraPositions: values.optInExtraPositions,
        eligibilityConfirmedAt: now,
        policyReference: event.policyUrl ?? DEFAULT_POLICY_URL,
        status: 'PENDING',
        ageFlagged,
        amountCents: event.registrationFeeCents,
        expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await prisma.registration.findFirst({ where: duplicateWhere });
      throw new RegistrationConflictError('duplicate', existing);
    }
    throw err;
  }
}

export async function withdrawRegistration(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  _now: Date,
): Promise<Registration | null> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE
    `);
    if (event.length === 0) return null;
    const result = await tx.registration.updateMany({
      where: { id: registrationId, eventId },
      data: { status: 'WITHDRAWN', checkedInAt: null, checkedInBy: null, bibNumber: null },
    });
    if (result.count === 0) return null;
    return tx.registration.findUnique({ where: { id: registrationId } });
  });
}
