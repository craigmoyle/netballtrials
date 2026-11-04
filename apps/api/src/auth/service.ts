import type { Prisma, PrismaClient, StaffUser } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { hashToken, newLoginToken, newSession } from './tokens';

const MAX_ACTIVE_LOGIN_LINKS = 3;
export const MAX_TEST_ADMINS = 5;

async function lockAdminRoster(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(1397051019)) AS admin_roster_lock`;
}

export type LoginDeps = {
  prisma: PrismaClient;
  mailer: EmailProvider;
  webOrigin: string;
  maxAdmins?: number;
};

export type ConsumeResult = {
  userId: string;
  sessionToken: string;
};

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export class AdminBootstrapError extends Error {
  constructor() {
    super('Admin bootstrap already used');
    this.name = 'AdminBootstrapError';
  }
}

export async function bootstrapFirstAdmin(
  deps: LoginDeps,
  rawEmail: string,
  now: Date,
): Promise<StaffUser> {
  const email = normalizeEmail(rawEmail);
  const user = await deps.prisma.$transaction(async (tx) => {
    await lockAdminRoster(tx);
    const users = await tx.staffUser.findMany({
      select: { id: true, email: true, invitedByUserId: true },
      take: 2,
    });
    if (users.length === 0) {
      return tx.staffUser.create({ data: { email } });
    }
    if (users.length === 1 && users[0].email === email && users[0].invitedByUserId === null) {
      return tx.staffUser.findUniqueOrThrow({ where: { id: users[0].id } });
    }
    throw new AdminBootstrapError();
  });
  await requestLoginLink(deps, email, now);
  return user;
}

export class AdminLimitReachedError extends Error {
  constructor() {
    super('Admin limit reached');
    this.name = 'AdminLimitReachedError';
  }
}

export type AdminRemovalResult = 'removed' | 'not_found' | 'self' | 'actor_revoked';

export async function removeAdmin(prisma: PrismaClient, staffId: string, actorUserId: string): Promise<AdminRemovalResult> {
  return prisma.$transaction(async (tx) => {
    await lockAdminRoster(tx);
    const actor = await tx.staffUser.findUnique({ where: { id: actorUserId }, select: { id: true } });
    if (!actor) return 'actor_revoked';
    if (staffId === actorUserId) return 'self';
    const target = await tx.staffUser.findUnique({ where: { id: staffId }, select: { id: true } });
    if (!target) return 'not_found';
    await tx.staffUser.delete({ where: { id: staffId } });
    return 'removed';
  });
}

export async function inviteAdmin(
  deps: LoginDeps,
  rawEmail: string,
  invitedByUserId: string,
  now: Date,
): Promise<StaffUser> {
  const email = normalizeEmail(rawEmail);
  const user = await deps.prisma.$transaction(async (tx) => {
    await lockAdminRoster(tx);
    const existing = await tx.staffUser.findUnique({ where: { email } });
    if (existing) return existing;
    if (deps.maxAdmins !== undefined && await tx.staffUser.count() >= deps.maxAdmins) {
      throw new AdminLimitReachedError();
    }
    return tx.staffUser.create({ data: { email, invitedByUserId } });
  });
  await requestLoginLink(deps, email, now);
  return user;
}

export async function requestLoginLink(
  deps: LoginDeps,
  rawEmail: string,
  now: Date,
): Promise<{ sent: true }> {
  const email = normalizeEmail(rawEmail);
  const user = await deps.prisma.staffUser.findUnique({ where: { email } });

  if (!user) {
    return { sent: true };
  }

  const record = newLoginToken(now);
  await deps.prisma.loginToken.create({
    data: {
      userId: user.id,
      tokenHash: record.tokenHash,
      expiresAt: record.expiresAt,
      createdAt: now,
    },
  });

  // Keep a few recent links usable so a newer request (or someone else
  // requesting on the admin's behalf) does not void the link they are about to open.
  const stale = await deps.prisma.loginToken.findMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: MAX_ACTIVE_LOGIN_LINKS,
    select: { id: true },
  });
  if (stale.length > 0) {
    await deps.prisma.loginToken.updateMany({
      where: { id: { in: stale.map((token) => token.id) }, usedAt: null },
      data: { usedAt: now },
    });
  }

  const link = `${deps.webOrigin}/admin/verify#token=${record.token}`;
  await deps.mailer.send({
    to: email,
    subject: 'Sign in to Netball Trials',
    text: `Use this link to sign in to the Netball Trials admin: ${link}`,
  });

  return { sent: true };
}

export async function consumeLoginToken(
  deps: { prisma: PrismaClient },
  token: string,
  now: Date,
): Promise<ConsumeResult | null> {
  const tokenHash = hashToken(token);
  const found = await deps.prisma.loginToken.findUnique({ where: { tokenHash } });

  if (!found || found.usedAt !== null || found.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  // Claim the token atomically so two simultaneous verifications cannot both
  // create a session from one link.
  const claimed = await deps.prisma.loginToken.updateMany({
    where: { id: found.id, usedAt: null },
    data: { usedAt: now },
  });

  if (claimed.count !== 1) {
    return null;
  }

  const session = newSession(now);
  await deps.prisma.session.create({
    data: {
      userId: found.userId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
    },
  });

  return { userId: found.userId, sessionToken: session.token };
}
