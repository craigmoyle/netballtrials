import { Prisma, type PrismaClient } from '@prisma/client';

const CLEANUP_INTERVAL = 1024;
const KEEP_MS = 24 * 60 * 60 * 1000;
let callsSinceCleanup = 0;

function expandIpv6(address: string): number[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(':') : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const groups = halves.length === 2
    ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
    : head;
  if (groups.length !== 8 || !groups.every((group) => /^[\da-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * Rate-limit identity for a client IP. IPv6 clients usually control a whole /64,
 * so they share one bucket per /64; IPv4-mapped IPv6 addresses count as IPv4.
 */
export function rateLimitClientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const groups = expandIpv6(ip.split('%')[0]);
  if (!groups) return ip;
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}

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
