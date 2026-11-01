import 'dotenv/config';
import { prisma } from '../db';
import { anonymizeExpiredRegistrations, anonymizeIncompleteRegistrations, INCOMPLETE_REGISTRATION_RETENTION_DAYS, pruneParentAccessArtifacts, pruneRateLimitBuckets, pruneStaffAuthArtifacts } from '../retention/service';

async function main(): Promise<void> {
  const now = new Date();
  const count = await anonymizeExpiredRegistrations(prisma, now, ({ eventId, deliveries }) => {
    process.exitCode = 1;
    for (const delivery of deliveries) {
      console.error(`retention: deferred event ${eventId}, delivery ${delivery.id} (${delivery.status}, attempt ${delivery.attempts})`);
      console.error(`retention: wait for worker completion, or verify the original worker is stopped before using npm run mail:reconcile -w @netball-trials/api -- --delivery-id ${delivery.id} --expected-attempt ${delivery.attempts} --outcome unknown --acknowledge-worker-stopped; see README production operations, then rerun retention`);
    }
  });
  console.log(`retention: anonymised ${count} registrations past the 4-calendar-year cutoff`);
  const incomplete = await anonymizeIncompleteRegistrations(prisma, now, ({ eventId, deliveries }) => {
    process.exitCode = 1;
    for (const delivery of deliveries) {
      console.error(`retention: deferred incomplete registration cleanup for event ${eventId}, delivery ${delivery.id} (${delivery.status}, attempt ${delivery.attempts})`);
    }
  });
  console.log(`retention: anonymised ${incomplete} incomplete registrations older than ${INCOMPLETE_REGISTRATION_RETENTION_DAYS} days`);
  const parentArtifacts = await pruneParentAccessArtifacts(prisma, now);
  console.log(`retention: pruned ${parentArtifacts.tokens} expired parent links and ${parentArtifacts.sessions} expired parent sessions`);
  const staffArtifacts = await pruneStaffAuthArtifacts(prisma, now);
  console.log(`retention: pruned ${staffArtifacts.tokens} expired Admin login links and ${staffArtifacts.sessions} expired Admin sessions`);
  const buckets = await pruneRateLimitBuckets(prisma, now);
  console.log(`retention: deleted ${buckets} idle rate-limit buckets`);
  const testOutbox = await prisma.testEmailOutbox.deleteMany({ where: { expiresAt: { lte: now } } });
  console.log(`retention: deleted ${testOutbox.count} expired test email outbox entries`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : 'Retention job failed');
    await prisma.$disconnect();
    process.exitCode = 1;
  });
