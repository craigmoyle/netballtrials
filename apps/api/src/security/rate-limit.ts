import { Prisma, type PrismaClient } from '@prisma/client';

const CLEANUP_INTERVAL = 1024;
const KEEP_MS = 24 * 60 * 60 * 1000;
let callsSinceCleanup = 0;

export async function resetRateLimit(prisma: PrismaClient, key: string): Promise<void> {
  await prisma.requestRateLimitBucket.deleteMany({ where: { key } });
}

export async function consumeRateLimit(
  prisma: PrismaClient,
  key: string,
  now: Date,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const expiredBefore = new Date(now.getTime() - windowMs);
  const rows = await prisma.$queryRaw<{ hits: number }[]>(Prisma.sql`
    INSERT INTO "RequestRateLimitBucket" ("key", "windowStartedAt", "hits", "updatedAt")
    VALUES (${key}, ${now}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "hits" = CASE
        WHEN "RequestRateLimitBucket"."windowStartedAt" <= ${expiredBefore} THEN 1
        ELSE "RequestRateLimitBucket"."hits" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "RequestRateLimitBucket"."windowStartedAt" <= ${expiredBefore} THEN ${now}
        ELSE "RequestRateLimitBucket"."windowStartedAt"
      END,
      "updatedAt" = ${now}
    RETURNING "hits"
  `);

  if ((++callsSinceCleanup % CLEANUP_INTERVAL) === 0) {
    void prisma.requestRateLimitBucket
      .deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - KEEP_MS) } } })
      .catch(() => undefined);
  }
  return (rows[0]?.hits ?? max + 1) <= max;
}
