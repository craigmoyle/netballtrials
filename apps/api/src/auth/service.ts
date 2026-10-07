import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { hashToken, newLoginToken, newSession } from './tokens';

export type LoginDeps = {
  prisma: PrismaClient;
  mailer: EmailProvider;
  webOrigin: string;
};

export type ConsumeResult = {
  userId: string;
  sessionToken: string;
};

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
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

  await deps.prisma.loginToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: now },
  });

  const record = newLoginToken(now);
  await deps.prisma.loginToken.create({
    data: {
      userId: user.id,
      tokenHash: record.tokenHash,
      expiresAt: record.expiresAt,
    },
  });

  const link = `${deps.webOrigin}/admin/verify?token=${record.token}`;
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
