import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type Registration } from '@prisma/client';
import { melbourneDateKey } from '@netball-trials/types';
import { ageAtDecember31, isAgeInRange, normalizePlayerName } from './eligibility';
import { DEFAULT_POLICY_URL } from '../policy';
import { isUniqueViolation } from '../errors';
import { registrationInputSchema, type RegistrationInput } from './schemas';

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export class RegistrationValidationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Invalid registration: ${fields.join(', ')}`);
    this.name = 'RegistrationValidationError';
    this.fields = fields;
  }
}

export class RegistrationIneligibleError extends Error {
  constructor(readonly competitionYear: number, readonly minAge: number, readonly maxAge: number) {
    super('Player is not eligible for this event');
    this.name = 'RegistrationIneligibleError';
  }
}

function policySnapshotUrl(baseUrl: string, eventId: string, version: number): string {
  return `${baseUrl.replace(/\/$/, '')}/api/public/events/${eventId}/policy-snapshots/${version}`;
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

async function createPendingRegistrationWithPolicy(
  prisma: PrismaClient,
  eventId: string,
  input: RegistrationInput,
  now: Date,
  adminAssisted: boolean,
  actorUserId?: string,
  policySnapshotBaseUrl = '',
): Promise<Registration> {
  const parsed = registrationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RegistrationValidationError(parsed.error.issues.map((issue) => String(issue.path[0])));
  }
  const values = parsed.data;
  const dateOfBirth = new Date(`${values.dateOfBirth}T00:00:00.000Z`);
  const playerNameNormalized = normalizePlayerName(values.playerFirstName, values.playerLastName);
  let duplicateWhere: Prisma.RegistrationWhereInput;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
      const event = await tx.event.findUnique({ where: { id: eventId }, include: { policyDocument: true } });
      const allowed = adminAssisted
        ? event && (event.status === 'OPEN' || event.status === 'CLOSED') && melbourneDateKey(now) === event.eventDate.toISOString().slice(0, 10)
        : event?.status === 'OPEN' && !event.registrationClosedAt && event.registrationClosesAt.getTime() > now.getTime();
      if (!event || !allowed) throw new RegistrationConflictError('closed');
      if (values.dateOfBirth > melbourneDateKey(now)) throw new RegistrationValidationError(['dateOfBirth']);
      const policySnapshot = await tx.eventPolicySnapshot.findFirst({ where: { eventId }, orderBy: { version: 'desc' } }) ??
        await tx.eventPolicySnapshot.create({ data: {
          eventId,
          version: 1,
          policyReference: policySnapshotUrl(policySnapshotBaseUrl, eventId, 1),
          competitionYear: event.competitionYear,
          minAge: event.minAge,
          maxAge: event.maxAge,
          policyUrl: event.policyUrl ?? DEFAULT_POLICY_URL,
          policyDocumentName: event.policyDocument?.fileName ?? null,
          policyDocumentBytes: event.policyDocument?.bytes ?? null,
          policyDocumentHash: event.policyDocument
            ? createHash('sha256').update(Buffer.from(event.policyDocument.bytes)).digest('hex')
            : null,
        } });
      const age = ageAtDecember31(dateOfBirth, policySnapshot.competitionYear);
      if (!isAgeInRange(age, policySnapshot.minAge, policySnapshot.maxAge)) {
        throw new RegistrationIneligibleError(policySnapshot.competitionYear, policySnapshot.minAge, policySnapshot.maxAge);
      }

      const association = await tx.memberAssociation.findFirst({
        where: { name: values.memberAssociation, active: true },
        select: { id: true },
      });
      if (!association) throw new RegistrationValidationError(['memberAssociation']);

      await tx.registration.updateMany({
        where: { eventId, status: 'PENDING', expiresAt: { lt: now } },
        data: { status: 'EXPIRED' },
      });
      duplicateWhere = {
        eventId,
        playerNameNormalized,
        dateOfBirth,
        status: { in: adminAssisted
          ? ['PENDING', 'PAID', 'WITHDRAWN', 'DUPLICATE', 'EXPIRED', 'FAILED']
          : ['PENDING', 'PAID', 'WITHDRAWN', 'DUPLICATE', 'EXPIRED', 'FAILED'] },
      };
      const existing = await tx.registration.findFirst({ where: duplicateWhere });
      if (existing) throw new RegistrationConflictError('duplicate', existing);

      const registration = await tx.registration.create({
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
          parentAuthorityConfirmedAt: now,
          policyReference: policySnapshotUrl(policySnapshotBaseUrl, eventId, policySnapshot.version),
          policySnapshotId: policySnapshot.id,
          adminAssistedAt: adminAssisted ? now : null,
          status: 'PENDING',
          ageFlagged: false,
          amountCents: event.registrationFeeCents,
          expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
        },
      });
      if (adminAssisted) await tx.auditEvent.create({
        data: {
          eventId,
          registrationId: registration.id,
          actorType: 'ADMIN',
          actorUserId,
          action: 'LATE_ADDITION_CREATED', reason: 'Admin-assisted late addition started',
          entityType: 'Registration',
          entityId: registration.id,
          afterState: { status: registration.status, adminAssistedAt: now.toISOString() },
          createdAt: now,
        },
      });
      return registration;
    });
  } catch (error) {
    if (error instanceof RegistrationConflictError || error instanceof RegistrationValidationError || error instanceof RegistrationIneligibleError) throw error;
    if (isUniqueViolation(error)) {
      const existing = await prisma.registration.findFirst({ where: duplicateWhere! });
      throw new RegistrationConflictError('duplicate', existing);
    }
    throw error;
  }
}

export function createPendingRegistration(
  prisma: PrismaClient,
  eventId: string,
  input: RegistrationInput,
  now: Date,
  policySnapshotBaseUrl = '',
): Promise<Registration> {
  return createPendingRegistrationWithPolicy(prisma, eventId, input, now, false, undefined, policySnapshotBaseUrl);
}

export function createAdminPendingRegistration(
  prisma: PrismaClient,
  eventId: string,
  input: RegistrationInput,
  now: Date,
  actorUserId?: string,
  policySnapshotBaseUrl = '',
): Promise<Registration> {
  return createPendingRegistrationWithPolicy(prisma, eventId, input, now, true, actorUserId, policySnapshotBaseUrl);
}

export class RegistrationWithdrawalError extends Error {
  constructor(readonly code: 'checkout_in_progress' | 'checkout_unavailable') {
    super(code);
    this.name = 'RegistrationWithdrawalError';
  }
}

export async function withdrawRegistration(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  now: Date,
  expireCheckout?: (sessionId: string) => Promise<boolean>,
  audit: { actorUserId?: string; actorType?: string; reason?: string } = {},
): Promise<Registration | null> {
  const snapshot = await prisma.registration.findFirst({
    where: { id: registrationId, eventId },
    select: { status: true, checkoutSessionId: true },
  });
  if (!snapshot) return null;
  if (snapshot.status === 'PENDING' && snapshot.checkoutSessionId) {
    if (!expireCheckout) throw new RegistrationWithdrawalError('checkout_unavailable');
    try {
      if (!(await expireCheckout(snapshot.checkoutSessionId))) throw new RegistrationWithdrawalError('checkout_in_progress');
    } catch (error) {
      if (error instanceof RegistrationWithdrawalError) throw error;
      throw new RegistrationWithdrawalError('checkout_unavailable');
    }
  }

  return prisma.$transaction(async (tx) => {
    const event = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE
    `);
    if (event.length === 0) return null;
    const result = await tx.registration.updateMany({
      where: { id: registrationId, eventId, checkoutSessionId: snapshot.checkoutSessionId },
      data: { status: 'WITHDRAWN', checkedInAt: null, checkedInBy: null, bibNumber: null },
    });
    if (result.count === 0) {
      const current = await tx.registration.findFirst({ where: { id: registrationId, eventId }, select: { status: true, checkoutSessionId: true } });
      if (current?.status === 'PENDING' && current.checkoutSessionId !== snapshot.checkoutSessionId) {
        throw new RegistrationWithdrawalError('checkout_in_progress');
      }
      return null;
    }
    const withdrawn = await tx.registration.findUniqueOrThrow({ where: { id: registrationId } });
    await tx.auditEvent.create({ data: {
      eventId, registrationId, actorType: audit.actorType ?? (audit.actorUserId ? 'ADMIN' : 'SYSTEM'), actorUserId: audit.actorUserId,
      action: 'REGISTRATION_WITHDRAWN', entityType: 'Registration', entityId: registrationId,
      reason: audit.reason ?? 'Registration withdrawn', beforeState: { status: snapshot.status },
      afterState: { status: 'WITHDRAWN' }, createdAt: now,
    } });
    return withdrawn;
  });
}
