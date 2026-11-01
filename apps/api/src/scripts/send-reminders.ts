import 'dotenv/config';
import { prisma } from '../db';
import { createApp } from '../app';
import { sendDueReminders } from '../messages/reminders';
import { retryPendingConfirmations } from '../messages/confirmation-retry';
import { retryPendingCheckouts } from '../messages/checkout-retry';
import { runDueScheduledMessages } from '../messages/communications';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const app = createApp();
  try {
    await app.ready();
    const sendsRealEmail = app.testDeps.env.APP_ENV === 'production' || app.testDeps.env.ENABLE_TEST_INTEGRATIONS;
    if (sendsRealEmail && (!('provider' in app.testDeps.mailer) || app.testDeps.mailer.provider !== 'gmail-api')) {
      throw new Error('Live reminder runs require configured Gmail credentials.');
    }
    if (!sendsRealEmail && !dryRun) {
      throw new Error('Non-production reminder runs require --dry-run unless test integrations are explicitly enabled');
    }
    const result = await sendDueReminders(
      { prisma, mailer: app.testDeps.mailer },
      new Date(),
      { dryRun },
    );
    console.log(
      `reminders${dryRun ? ' (dry run)' : ''}: ${result.sent} sent, ${result.simulated} simulated, ${result.failed} failed, ${result.ambiguous} ambiguous, ${result.events} events due`,
    );
    for (const failure of result.errors) {
      console.error(`reminders: event ${failure.eventId} failed: ${failure.message}`);
    }

    const confirmations = await retryPendingConfirmations(
      { prisma, mailer: app.testDeps.mailer, webOrigin: app.testDeps.env.WEB_ORIGIN },
      new Date(),
      { dryRun },
    );
    console.log(
      `confirmation retries${dryRun ? ' (dry run)' : ''}: ${confirmations.due} due, ${confirmations.sent} sent, ${confirmations.simulated} simulated, ${confirmations.failed} failed, ${confirmations.ambiguous} ambiguous, ${confirmations.errors} errors`,
    );
    const scheduled = dryRun ? { completed: 0, failed: 0 } : await runDueScheduledMessages(
      { prisma, mailer: app.testDeps.mailer },
      new Date(),
    );
    console.log(`scheduled communications: ${scheduled.completed} completed, ${scheduled.failed} failed`);

    const checkouts = await retryPendingCheckouts(
      { prisma, mailer: app.testDeps.mailer },
      new Date(),
      { dryRun },
    );
    console.log(
      `checkout retries${dryRun ? ' (dry run)' : ''}: ${checkouts.due} due, ${checkouts.sent} sent, ${checkouts.simulated} simulated, ${checkouts.failed} failed, ${checkouts.ambiguous} ambiguous, ${checkouts.errors} errors`,
    );
    if (result.errors.length > 0 || result.failed > 0 || result.ambiguous > 0 || confirmations.errors > 0 ||
        confirmations.failed > 0 || confirmations.ambiguous > 0 || checkouts.errors > 0 || checkouts.failed > 0 ||
        checkouts.ambiguous > 0 || scheduled.failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : 'Reminder job failed');
    await prisma.$disconnect();
    process.exitCode = 1;
  });
