import 'dotenv/config';
import { prisma } from '../db';
import { createApp } from '../app';
import { sendDueReminders } from '../messages/reminders';

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
