import { createHash } from 'node:crypto';
import { Prisma, type ParentAccessTokenPurpose, type PrismaClient, type Registration } from '@prisma/client';
import type { IncompleteRegistrationDTO, ParentRegistrationDTO, Position, RegistrationChangeDTO } from '@netball-trials/types';
import type { AppDeps } from '../app';
import { normalizeEmail } from '../auth/service';
import { generateToken, hashToken, LOGIN_TOKEN_TTL_MINUTES } from '../auth/tokens';
import { normalizePlayerName } from '../registrations/eligibility';
import { positionsAreDistinct } from '../registrations/schemas';
import { createRegistrationCheckout, sendCheckoutContinuation } from '../registrations/checkout';
import { INTERRUPTED_SEND, lockMailEvent } from '../mail/lifecycle';
import { isPastRetentionCutoff } from '../retention/service';
import { consumeRateLimit, rateLimitClientKey } from '../security/rate-limit';

export const PARENT_SESSION_TTL_HOURS = 12;
export const INCOMPLETE_REGISTRATION_RETENTION_DAYS = 30;
const PARENT_LINK_LIMIT = 5;
const PARENT_LINK_WINDOW_MS = 15 * 60_000;
const PARENT_EMAIL_LIMIT = 3;
const PARENT_EMAIL_WINDOW_MS = LOGIN_TOKEN_TTL_MINUTES * 60_000;

export class ParentAccessError extends Error {
  constructor(readonly code: 'not_found' | 'registration_locked' | 'duplicate_player' | 'email_change_conflict' | 'checkout_unavailable' | 'checkout_in_progress' | 'invalid_positions' | 'email_change_busy' | 'email_rate_limited') {
    super(code);
    this.name = 'ParentAccessError';
  }
}

function parentEmailRateKey(email: string): string {
  return createHash('sha256').update(`parent-login-email\0${email}`).digest('hex');
}

async function sendParentToken(
  deps: AppDeps,
  email: string,
  purpose: ParentAccessTokenPurpose,
  now: Date,
  registrationId?: string,
  newEmail?: string,
): Promise<void> {
  const token = generateToken();
  await deps.prisma.parentAccessToken.create({
    data: {
      email: normalizeEmail(email),
      purpose,
      registrationId,
      newEmail: newEmail ? normalizeEmail(newEmail) : null,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MINUTES * 60_000),
      createdAt: now,
    },
  });

  const registrationEmailChange = purpose === 'REGISTRATION_EMAIL_CHANGE';
  const emailChange = purpose === 'EMAIL_CHANGE';
  const signIn = purpose === 'SIGN_IN';
  const action = emailChange ? 'email-change' : registrationEmailChange ? 'registration-email-change' : signIn ? 'sign-in' : null;
  const link = `${deps.env.WEB_ORIGIN}/manage-registration/verify#token=${token}${action ? `&action=${action}` : ''}`;
  const changesEmail = emailChange || registrationEmailChange;
  await deps.mailer.send({
    to: changesEmail && newEmail ? normalizeEmail(newEmail) : normalizeEmail(email),
    subject: emailChange ? 'Confirm your new Netball Trials email'
      : registrationEmailChange ? 'Confirm your Netball Trials email'
        : signIn ? 'Sign in to manage your Netball Trials registrations' : 'Confirm your Netball Trials email',
    text: emailChange
      ? `Confirm this email to update the address used for your Netball Trials registrations: ${link}\n\nYour existing email address must also be signed in to complete this change. This link expires in ${LOGIN_TOKEN_TTL_MINUTES} minutes. If you did not request this, ignore this email.`
      : registrationEmailChange
        ? `Confirm this email address to continue managing your Netball Trials registration: ${link}\n\nThis one-time link expires in ${LOGIN_TOKEN_TTL_MINUTES} minutes. If you did not ask the club to correct your email, contact the club.`
        : signIn
          ? `Use this one-time link to manage registrations associated with this email: ${link}\n\nThis link expires in ${LOGIN_TOKEN_TTL_MINUTES} minutes. If you did not request this, ignore this email.`
          : `Confirm your email to continue your Netball Trials registration or sign in to manage registrations: ${link}\n\nYour registration is not complete until this email is verified and payment is confirmed. This link expires in ${LOGIN_TOKEN_TTL_MINUTES} minutes. If you did not request this, ignore this email.`,
  });
}

export async function sendRegistrationEmailVerification(
  deps: AppDeps,
  registration: Pick<Registration, 'id' | 'parentEmail'>,
  now = new Date(),
): Promise<boolean> {
  try {
    await sendParentToken(deps, registration.parentEmail, 'REGISTRATION_VERIFY', now, registration.id);
    return true;
  } catch {
    return false;
  }
}

export async function requestParentAccessLink(
  deps: AppDeps,
  rawEmail: string,
  ip: string | undefined,
  now = new Date(),
): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const ipKey = createHash('sha256')
    .update(`parent-login\0${rateLimitClientKey(ip)}\0${email}`)
    .digest('hex');
  if (!(await consumeRateLimit(deps.prisma, ipKey, now, PARENT_LINK_LIMIT, PARENT_LINK_WINDOW_MS))) return;
  if (!(await consumeRateLimit(deps.prisma, parentEmailRateKey(email), now, PARENT_EMAIL_LIMIT, PARENT_EMAIL_WINDOW_MS))) return;

  setImmediate(() => {
    void (async () => {
      const registrations = await deps.prisma.registration.findMany({
        where: { parentEmail: { equals: email, mode: 'insensitive' }, anonymizedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, parentEmail: true, parentEmailVerifiedAt: true },
      });
      if (!registrations.length) return;

      const verified = registrations.some((registration) => registration.parentEmailVerifiedAt !== null);
      const target = registrations.find((registration) => registration.parentEmailVerifiedAt === null) ?? registrations[0];
      await sendParentToken(
        deps,
        target.parentEmail,
        verified ? 'SIGN_IN' : 'REGISTRATION_VERIFY',
        now,
        verified ? undefined : target.id,
      );
    })().catch(() => deps.log?.warn({ code: 'parent_access_link_failed' }, 'parent_access_link_failed'));
  });
}

type ParentSessionResult = { email: string; sessionToken: string; sessionId: string; expiresAt: Date };

async function consumeRegistrationEmailCorrection(
  prisma: PrismaClient,
  token: Prisma.ParentAccessTokenGetPayload<{}>,
  now: Date,
): Promise<ParentSessionResult | null> {
  if (!token.registrationId || !token.newEmail) return null;
  const currentEmail = normalizeEmail(token.email);
  const newEmail = normalizeEmail(token.newEmail);
  const cutoff = new Date(now.getTime() - INCOMPLETE_REGISTRATION_RETENTION_DAYS * 24 * 60 * 60_000);
  try {
    return await prisma.$transaction(async (tx) => {
      for (const address of [currentEmail, newEmail].sort()) {
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(0, hashtext(${address}))) AS _lock`);
      }
      const registration = await tx.registration.findFirst({
        where: {
          id: token.registrationId!,
          parentEmail: { equals: currentEmail, mode: 'insensitive' },
          parentEmailVerifiedAt: null,
          createdAt: { gte: cutoff },
          anonymizedAt: null,
          status: { in: ['PENDING', 'EXPIRED', 'FAILED'] },
        },
        select: { id: true },
      });
      if (!registration) throw new ParentAccessError('not_found');
      const claimed = await tx.parentAccessToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new ParentAccessError('not_found');
      const updated = await tx.registration.updateMany({
        where: {
          id: registration.id,
          parentEmail: { equals: currentEmail, mode: 'insensitive' },
          parentEmailVerifiedAt: null,
          createdAt: { gte: cutoff },
          anonymizedAt: null,
          status: { in: ['PENDING', 'EXPIRED', 'FAILED'] },
        },
        data: { parentEmail: newEmail, parentEmailVerifiedAt: now },
      });
      if (updated.count !== 1) throw new ParentAccessError('not_found');
      await tx.registrationChangeLog.create({
        data: {
          registrationId: registration.id,
          actorType: 'ADMIN',
          changedFields: ['parentEmail'],
          changeData: { parentEmail: { from: token.email, to: newEmail } },
        },
      });
      const sessionToken = generateToken();
      const expiresAt = new Date(now.getTime() + PARENT_SESSION_TTL_HOURS * 60 * 60_000);
      const session = await tx.parentAccessSession.create({
        data: { email: newEmail, tokenHash: hashToken(sessionToken), expiresAt, createdAt: now },
        select: { id: true },
      });
      return { email: newEmail, sessionToken, sessionId: session.id, expiresAt };
    });
  } catch (error) {
    if (error instanceof ParentAccessError && ['not_found', 'email_change_conflict'].includes(error.code)) return null;
    throw error;
  }
}

export async function consumeParentAccessToken(
  prisma: PrismaClient,
  rawToken: string,
  now = new Date(),
): Promise<ParentSessionResult | null> {
  const found = await prisma.parentAccessToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!found || found.usedAt !== null || found.expiresAt <= now) return null;
  if (found.purpose === 'EMAIL_CHANGE') return null;
  if (found.purpose === 'REGISTRATION_EMAIL_CHANGE') return consumeRegistrationEmailCorrection(prisma, found, now);

  const matching = await prisma.registration.findMany({
    where: { parentEmail: { equals: found.email, mode: 'insensitive' }, anonymizedAt: null },
    select: { id: true, parentEmailVerifiedAt: true },
  });
  if (!matching.length) return null;
  if (found.purpose === 'SIGN_IN' && !matching.some((registration) => registration.parentEmailVerifiedAt !== null)) return null;
  if (found.purpose === 'REGISTRATION_VERIFY' && found.registrationId && !matching.some((registration) => registration.id === found.registrationId)) return null;

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.parentAccessToken.updateMany({
      where: { id: found.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const email = normalizeEmail(found.email);
    await tx.registration.updateMany({
      where: { parentEmail: { equals: email, mode: 'insensitive' }, anonymizedAt: null, parentEmailVerifiedAt: null },
      data: { parentEmailVerifiedAt: now },
    });

    const sessionToken = generateToken();
    const expiresAt = new Date(now.getTime() + PARENT_SESSION_TTL_HOURS * 60 * 60_000);
    const session = await tx.parentAccessSession.create({
      data: { email, tokenHash: hashToken(sessionToken), expiresAt, createdAt: now },
      select: { id: true },
    });
    return { email, sessionToken, sessionId: session.id, expiresAt };
  });
}

export async function expireParentAccessSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.parentAccessSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

function parentRegistrationDto(
  registration: Prisma.RegistrationGetPayload<{ include: { event: true } }>,
  now: Date,
): ParentRegistrationDTO {
  const locked = registration.event.status !== 'OPEN' || registration.event.checkInClosedAt !== null ||
    registration.checkedInAt !== null || registration.bibNumber !== null ||
    !['PENDING', 'PAID'].includes(registration.status);
  return {
    id: registration.id,
    playerFirstName: registration.playerFirstName,
    playerLastName: registration.playerLastName,
    playerName: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
    dateOfBirth: registration.dateOfBirth.toISOString().slice(0, 10),
    parentName: registration.parentName,
    parentEmail: registration.parentEmail,
    parentMobile: registration.parentMobile,
    memberAssociation: registration.memberAssociation,
    rank1Position: registration.rank1Position,
    rank2Position: registration.rank2Position,
    rank3Position: registration.rank3Position,
    optInExtraPositions: registration.optInExtraPositions,
    status: registration.status,
    amountCents: registration.amountCents,
    currency: registration.currency,
    number: registration.bibNumber,
    checkedInAt: registration.checkedInAt?.toISOString() ?? null,
    ageFlagged: registration.ageFlagged,
    createdAt: registration.createdAt.toISOString(),
    expiresAt: registration.expiresAt.toISOString(),
    parentEmailVerifiedAt: registration.parentEmailVerifiedAt?.toISOString() ?? null,
    parentFollowUpSentAt: registration.parentFollowUpSentAt?.toISOString() ?? null,
    canEdit: !locked,
    canWithdraw: !locked,
    canContinueCheckout: registration.status === 'PENDING' && registration.parentEmailVerifiedAt !== null && registration.expiresAt > now,
    ticketPath: registration.status === 'PAID' && registration.qrToken ? `/ticket/${encodeURIComponent(registration.qrToken)}` : null,
    event: {
      id: registration.event.id,
      name: registration.event.name,
      eventDate: registration.event.eventDate.toISOString().slice(0, 10),
      venue: registration.event.venue,
      startTime: registration.event.startTime,
      gameStartTime: registration.event.gameStartTime,
      status: registration.event.status,
    },
  };
}

export async function listParentRegistrations(
  prisma: PrismaClient,
  email: string,
  now = new Date(),
): Promise<ParentRegistrationDTO[]> {
  const registrations = await prisma.registration.findMany({
    where: {
      parentEmail: { equals: normalizeEmail(email), mode: 'insensitive' },
      parentEmailVerifiedAt: { not: null },
      anonymizedAt: null,
    },
    include: { event: true },
    orderBy: [{ event: { eventDate: 'desc' } }, { createdAt: 'desc' }],
  });
  return registrations
    .filter((registration) => !isPastRetentionCutoff(registration.event.eventDate, now))
    .map((registration) => parentRegistrationDto(registration, now));
}

export type ParentRegistrationUpdate = {
  playerFirstName?: string;
  playerLastName?: string;
  parentName?: string;
  parentMobile?: string;
  rank1Position?: Position;
  rank2Position?: Position | null;
  rank3Position?: Position | null;
  optInExtraPositions?: boolean;
};

export async function updateParentRegistration(
  prisma: PrismaClient,
  email: string,
  registrationId: string,
  patch: ParentRegistrationUpdate,
  now = new Date(),
): Promise<ParentRegistrationDTO> {
  return prisma.$transaction(async (tx) => {
    const registration = await tx.registration.findFirst({
      where: {
        id: registrationId,
        parentEmail: { equals: normalizeEmail(email), mode: 'insensitive' },
        parentEmailVerifiedAt: { not: null },
        anonymizedAt: null,
      },
      include: { event: true },
    });
    if (!registration) throw new ParentAccessError('not_found');
    const currentDto = parentRegistrationDto(registration, now);
    if (!currentDto.canEdit) throw new ParentAccessError('registration_locked');

    const playerFirstName = patch.playerFirstName ?? registration.playerFirstName;
    const playerLastName = patch.playerLastName ?? registration.playerLastName;
    const playerNameNormalized = normalizePlayerName(playerFirstName, playerLastName);
    const rank1Position = patch.rank1Position ?? registration.rank1Position;
    const rank2Position = patch.rank2Position === undefined ? registration.rank2Position : patch.rank2Position;
    const rank3Position = patch.rank3Position === undefined ? registration.rank3Position : patch.rank3Position;
    if (!positionsAreDistinct({
      rank1Position,
      rank2Position: rank2Position ?? undefined,
      rank3Position: rank3Position ?? undefined,
    }) || (rank3Position !== null && rank3Position !== undefined && !rank2Position)) {
      throw new ParentAccessError('invalid_positions');
    }
    if (playerNameNormalized !== registration.playerNameNormalized) {
      const duplicate = await tx.registration.findFirst({
        where: {
          eventId: registration.eventId,
          playerNameNormalized,
          dateOfBirth: registration.dateOfBirth,
          status: { in: ['PENDING', 'PAID'] },
          anonymizedAt: null,
          id: { not: registration.id },
        },
        select: { id: true },
      });
      if (duplicate) throw new ParentAccessError('duplicate_player');
    }

    const values = {
      ...patch,
      playerNameNormalized,
    };
    const changedFields = Object.keys(patch).filter((field) => {
      const oldValue = registration[field as keyof typeof registration];
      return oldValue !== patch[field as keyof ParentRegistrationUpdate];
    });
    if (changedFields.length === 0) return currentDto;

    const updatedCount = await tx.registration.updateMany({
      where: {
        id: registration.id,
        parentEmail: { equals: normalizeEmail(email), mode: 'insensitive' },
        parentEmailVerifiedAt: { not: null },
        anonymizedAt: null,
        status: { in: ['PENDING', 'PAID'] },
        checkedInAt: null,
        bibNumber: null,
        event: { is: { status: 'OPEN', checkInClosedAt: null } },
      },
      data: values,
    });
    if (updatedCount.count !== 1) throw new ParentAccessError('registration_locked');
    const updated = await tx.registration.findUniqueOrThrow({ where: { id: registration.id }, include: { event: true } });
    const changeData = Object.fromEntries(changedFields.map((field) => [field, {
      from: registration[field as keyof typeof registration],
      to: patch[field as keyof ParentRegistrationUpdate],
    }]));
    await tx.registrationChangeLog.create({
      data: { registrationId: registration.id, actorType: 'PARENT', changedFields, changeData: changeData as Prisma.InputJsonObject },
    });
    return parentRegistrationDto(updated, now);
  });
}

export async function withdrawParentRegistration(
  deps: AppDeps,
  email: string,
  registrationId: string,
  now = new Date(),
): Promise<ParentRegistrationDTO> {
  const normalizedEmail = normalizeEmail(email);
  const registration = await deps.prisma.registration.findFirst({
    where: { id: registrationId, parentEmail: { equals: normalizedEmail, mode: 'insensitive' }, parentEmailVerifiedAt: { not: null }, anonymizedAt: null },
    include: { event: true },
  });
  if (!registration) throw new ParentAccessError('not_found');
  if (!parentRegistrationDto(registration, now).canWithdraw) throw new ParentAccessError('registration_locked');

  const checkoutSessionId = registration.checkoutSessionId;
  if (registration.status === 'PENDING' && checkoutSessionId) {
    try {
      if (!(await deps.payment.expireCheckout(checkoutSessionId))) throw new ParentAccessError('checkout_in_progress');
    } catch (error) {
      if (error instanceof ParentAccessError) throw error;
      throw new ParentAccessError('checkout_unavailable');
    }
  }

  return deps.prisma.$transaction(async (tx) => {
    if (!await lockMailEvent(tx, registration.eventId)) throw new ParentAccessError('not_found');
    const current = await tx.registration.findFirst({
      where: { id: registrationId, parentEmail: { equals: normalizedEmail, mode: 'insensitive' }, parentEmailVerifiedAt: { not: null }, anonymizedAt: null },
      include: { event: true },
    });
    if (!current) throw new ParentAccessError('not_found');
    if (!parentRegistrationDto(current, now).canWithdraw) throw new ParentAccessError('registration_locked');
    if (current.status === 'PENDING' && current.checkoutSessionId !== checkoutSessionId) {
      throw new ParentAccessError('checkout_in_progress');
    }

    const updatedCount = await tx.registration.updateMany({
      where: {
        id: current.id,
        parentEmail: { equals: normalizedEmail, mode: 'insensitive' },
        parentEmailVerifiedAt: { not: null },
        anonymizedAt: null,
        status: { in: ['PENDING', 'PAID'] },
        checkedInAt: null,
        bibNumber: null,
        checkoutSessionId,
        event: { is: { status: 'OPEN', checkInClosedAt: null } },
      },
      data: { status: 'WITHDRAWN', checkedInAt: null, checkedInBy: null, bibNumber: null },
    });
    if (updatedCount.count !== 1) throw new ParentAccessError('registration_locked');
    const updated = await tx.registration.findUniqueOrThrow({ where: { id: current.id }, include: { event: true } });
    await tx.registrationChangeLog.create({
      data: {
        registrationId: current.id,
        actorType: 'PARENT',
        changedFields: ['status'],
        changeData: { status: { from: current.status, to: 'WITHDRAWN' } },
      },
    });
    return parentRegistrationDto(updated, now);
  });
}

export async function continueParentCheckout(
  deps: AppDeps,
  email: string,
  registrationId: string,
  now = new Date(),
): Promise<{ checkoutUrl: string } | { simulationToken: string }> {
  const registration = await deps.prisma.registration.findFirst({
    where: {
      id: registrationId,
      parentEmail: { equals: normalizeEmail(email), mode: 'insensitive' },
      parentEmailVerifiedAt: { not: null },
      anonymizedAt: null,
      status: 'PENDING',
      expiresAt: { gt: now },
    },
  });
  if (!registration) throw new ParentAccessError('registration_locked');
  const checkout = await createRegistrationCheckout(deps, registration);
  if (!checkout) throw new ParentAccessError('checkout_unavailable');
  if (deps.env.PAYMENT_PROVIDER === 'fake' && deps.env.NODE_ENV !== 'production') {
    return { simulationToken: checkout.sessionId };
  }
  return { checkoutUrl: checkout.url };
}

export async function requestParentEmailChange(
  deps: AppDeps,
  currentEmail: string,
  newEmail: string,
  now = new Date(),
): Promise<'sent' | 'unchanged' | 'rate_limited'> {
  const current = normalizeEmail(currentEmail);
  const next = normalizeEmail(newEmail);
  if (current === next) return 'unchanged';
  if (!(await consumeRateLimit(deps.prisma, parentEmailRateKey(current), now, PARENT_EMAIL_LIMIT, PARENT_EMAIL_WINDOW_MS))) return 'rate_limited';
  await sendParentToken(deps, current, 'EMAIL_CHANGE', now, undefined, next);
  return 'sent';
}

export async function confirmParentEmailChange(
  deps: AppDeps,
  currentEmail: string,
  sessionId: string,
  rawToken: string,
  now = new Date(),
): Promise<string> {
  const token = await deps.prisma.parentAccessToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  const current = normalizeEmail(currentEmail);
  if (!token || token.purpose !== 'EMAIL_CHANGE' || token.usedAt || token.expiresAt <= now || normalizeEmail(token.email) !== current || !token.newEmail) {
    throw new ParentAccessError('not_found');
  }
  const newEmail = normalizeEmail(token.newEmail);

  await deps.prisma.$transaction(async (tx) => {
    for (const address of [current, newEmail].sort()) {
      await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(0, hashtext(${address}))) AS _lock`);
    }
    const claimed = await tx.parentAccessToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new ParentAccessError('not_found');
    const registrations = await tx.registration.findMany({
      where: { parentEmail: { equals: current, mode: 'insensitive' }, anonymizedAt: null },
      select: { id: true, eventId: true },
    });
    if (!registrations.length) throw new ParentAccessError('not_found');
    const registrationIds = registrations.map((registration) => registration.id);
    for (const eventId of [...new Set(registrations.map((registration) => registration.eventId))].sort()) {
      if (!await lockMailEvent(tx, eventId)) throw new ParentAccessError('not_found');
    }
    const inFlightDelivery = await tx.emailLog.findFirst({
      where: {
        registrationId: { in: registrationIds },
        OR: [{ status: 'SENDING' }, { status: 'AMBIGUOUS', error: INTERRUPTED_SEND }],
      },
      select: { id: true },
    });
    if (inFlightDelivery) throw new ParentAccessError('email_change_busy');
    const conflict = await tx.registration.findFirst({
      where: { id: { notIn: registrationIds }, parentEmail: { equals: newEmail, mode: 'insensitive' }, anonymizedAt: null },
      select: { id: true },
    });
    if (conflict) throw new ParentAccessError('email_change_conflict');
    const updated = await tx.registration.updateMany({
      where: { id: { in: registrationIds }, parentEmail: { equals: current, mode: 'insensitive' }, anonymizedAt: null },
      data: { parentEmail: newEmail, parentEmailVerifiedAt: now },
    });
    if (updated.count === 0) throw new ParentAccessError('not_found');
    const changedRegistrations = await tx.registration.findMany({
      where: { id: { in: registrationIds }, parentEmail: newEmail, parentEmailVerifiedAt: now, anonymizedAt: null },
      select: { id: true },
    });
    await tx.registrationChangeLog.createMany({
      data: changedRegistrations.map((registration) => ({
        registrationId: registration.id,
        actorType: 'PARENT',
        changedFields: ['parentEmail'],
        changeData: { parentEmail: { from: current, to: newEmail } },
      })),
    });
    await tx.parentAccessSession.deleteMany({ where: { email: current, id: { not: sessionId } } });
    await tx.parentAccessSession.updateMany({
      where: { id: sessionId, email: current },
      data: { email: newEmail },
    });
  });

  try {
    await deps.mailer.send({
      to: current,
      subject: 'Your Netball Trials email was changed',
      text: 'The email used to manage Netball Trials registrations was changed. If you did not request this, contact the club.',
    });
  } catch {
    // The new address is already verified; notification failure must not undo the change.
  }
  return newEmail;
}

export async function requestIncompleteEmailCorrection(
  deps: AppDeps,
  eventId: string,
  registrationId: string,
  newEmail: string,
  now = new Date(),
): Promise<void> {
  const registration = await deps.prisma.registration.findFirst({
    where: {
      id: registrationId,
      eventId,
      createdAt: { gte: new Date(now.getTime() - INCOMPLETE_REGISTRATION_RETENTION_DAYS * 24 * 60 * 60_000) },
      parentEmailVerifiedAt: null,
      anonymizedAt: null,
      status: { in: ['PENDING', 'EXPIRED', 'FAILED'] },
    },
    select: { id: true, parentEmail: true },
  });
  if (!registration) throw new ParentAccessError('not_found');
  const correctedEmail = normalizeEmail(newEmail);
  if (correctedEmail === normalizeEmail(registration.parentEmail)) throw new ParentAccessError('email_change_conflict');
  if (!(await consumeRateLimit(deps.prisma, parentEmailRateKey(correctedEmail), now, PARENT_EMAIL_LIMIT, PARENT_EMAIL_WINDOW_MS))) {
    throw new ParentAccessError('email_rate_limited');
  }
  await sendParentToken(deps, registration.parentEmail, 'REGISTRATION_EMAIL_CHANGE', now, registration.id, correctedEmail);
}

function auditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

export async function listRegistrationChanges(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  now = new Date(),
): Promise<RegistrationChangeDTO[] | null> {
  const registration = await prisma.registration.findFirst({
    where: { id: registrationId, eventId, anonymizedAt: null },
    select: { event: { select: { eventDate: true } } },
  });
  if (!registration || isPastRetentionCutoff(registration.event.eventDate, now)) return null;
  const rows = await prisma.registrationChangeLog.findMany({
    where: { registrationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map((row) => {
    const stored = row.changeData && typeof row.changeData === 'object' && !Array.isArray(row.changeData)
      ? row.changeData as Record<string, { from?: unknown; to?: unknown }>
      : {};
    const fields = Array.isArray(row.changedFields) ? row.changedFields.filter((field): field is string => typeof field === 'string') : [];
    return {
      id: row.id,
      actorType: row.actorType,
      createdAt: row.createdAt.toISOString(),
      changedFields: fields,
      changes: fields.map((field) => ({ field, before: auditValue(stored[field]?.from), after: auditValue(stored[field]?.to) })),
    };
  });
}

export async function listIncompleteRegistrations(
  prisma: PrismaClient,
  eventId: string,
  now = new Date(),
): Promise<IncompleteRegistrationDTO[]> {
  const cutoff = new Date(now.getTime() - INCOMPLETE_REGISTRATION_RETENTION_DAYS * 24 * 60 * 60_000);
  const registrations = await prisma.registration.findMany({
    where: {
      eventId,
      createdAt: { gte: cutoff },
      anonymizedAt: null,
      status: { in: ['PENDING', 'EXPIRED', 'FAILED'] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true, playerFirstName: true, playerLastName: true, parentEmail: true, parentEmailVerifiedAt: true,
      status: true, createdAt: true, expiresAt: true, parentFollowUpSentAt: true,
    },
  });
  return registrations.map((registration) => ({
    id: registration.id,
    playerName: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
    parentEmail: registration.parentEmail,
    status: registration.status,
    parentEmailVerified: registration.parentEmailVerifiedAt !== null,
    startedAt: registration.createdAt.toISOString(),
    checkoutExpiresAt: registration.expiresAt.toISOString(),
    followUpSentAt: registration.parentFollowUpSentAt?.toISOString() ?? null,
    stage: registration.parentEmailVerifiedAt === null ? 'EMAIL_CONFIRMATION'
      : registration.status === 'PENDING' && registration.expiresAt > now ? 'PAYMENT' : 'PAYMENT_EXPIRED',
  }));
}

export async function sendIncompleteRegistrationReminder(
  deps: AppDeps,
  eventId: string,
  registrationId: string,
  senderUserId: string,
  now = new Date(),
): Promise<void> {
  const registration = await deps.prisma.registration.findFirst({
    where: {
      id: registrationId,
      eventId,
      parentEmailVerifiedAt: { not: null },
      parentFollowUpSentAt: null,
      status: 'PENDING',
      expiresAt: { gt: now },
      anonymizedAt: null,
    },
  });
  if (!registration) throw new ParentAccessError('registration_locked');
  const recipientKey = createHash('sha256').update(normalizeEmail(registration.parentEmail)).digest('hex').slice(0, 16);
  const sent = await sendCheckoutContinuation(deps, registration, now, {
    batchId: `parent-reminder:${registration.id}:${recipientKey}`,
    senderUserId,
  });
  if (!sent) throw new ParentAccessError('checkout_unavailable');
  await deps.prisma.registration.updateMany({
    where: { id: registration.id, parentFollowUpSentAt: null },
    data: { parentFollowUpSentAt: now },
  });
}
