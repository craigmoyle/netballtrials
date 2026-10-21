import 'dotenv/config';
import { prisma } from '../db';
import { createApp } from '../app';
import { sendDueReminders } from '../messages/reminders';
import { retryPendingConfirmations } from '../messages/confirmation-retry';
import { retryPendingCheckouts } from '../messages/checkout-retry';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const app = createApp();
  try {
    if (app.testDeps.env.NODE_ENV !== 'production' && !dryRun) {
      throw new Error('Non-production reminder runs require --dry-run');
    }
    const result = await sendDueReminders(
      { prisma, mailer: app.testDeps.mailer },
      new Date(),
      { dryRun },
    );
    console.log(
      `reminders${dryRun ? ' (dry run)' : ''}: ${result.sent} sent, ${result.failed} failed, ${result.ambiguous} ambiguous, ${result.events} events due`,
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
      `confirmation retries${dryRun ? ' (dry run)' : ''}: ${confirmations.due} due, ${confirmations.sent} sent, ${confirmations.failed} failed, ${confirmations.ambiguous} ambiguous, ${confirmations.errors} errors`,
    );
    const checkouts = await retryPendingCheckouts(
      { prisma, mailer: app.testDeps.mailer },
      new Date(),
      { dryRun },
    );
    console.log(
      `checkout retries${dryRun ? ' (dry run)' : ''}: ${checkouts.due} due, ${checkouts.sent} sent, ${checkouts.failed} failed, ${checkouts.ambiguous} ambiguous, ${checkouts.errors} errors`,
    );
    if (result.errors.length > 0 || confirmations.errors > 0 || checkouts.errors > 0) process.exitCode = 1;
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
