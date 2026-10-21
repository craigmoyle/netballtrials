import 'dotenv/config';
import { prisma } from '../db';
import { anonymizeExpiredRegistrations, pruneRateLimitBuckets } from '../retention/service';

async function main(): Promise<void> {
  const now = new Date();
  const count = await anonymizeExpiredRegistrations(prisma, now, ({ eventId, deliveries }) => {
    process.exitCode = 1;
    for (const delivery of deliveries) {
      console.error(`retention: deferred event ${eventId}, delivery ${delivery.id} (${delivery.status}, attempt ${delivery.attempts})`);
      console.error(`retention: wait for worker completion, or verify the original worker is stopped before using npm run mail:reconcile -w @netball-trials/api -- --delivery-id ${delivery.id} --expected-attempt ${delivery.attempts} --outcome unknown --acknowledge-worker-stopped; see README production operations, then rerun retention`);
    }
  });
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
