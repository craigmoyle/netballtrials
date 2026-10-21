import 'dotenv/config';
import { prisma } from '../db';
import { anonymizeExpiredRegistrations, pruneRateLimitBuckets } from '../retention/service';

async function main(): Promise<void> {
  const now = new Date();
  const count = await anonymizeExpiredRegistrations(prisma, now);
  console.log(`retention: anonymised ${count} registrations past the 12-calendar-month cutoff`);
  const buckets = await pruneRateLimitBuckets(prisma, now);
  console.log(`retention: deleted ${buckets} idle rate-limit buckets`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : 'Retention job failed');
    await prisma.$disconnect();
    process.exitCode = 1;
  });
