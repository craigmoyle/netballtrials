import 'dotenv/config';
import { createApp } from '../app';
import { bootstrapFirstAdmin, normalizeEmail } from '../auth/service';
import { prisma } from '../db';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    throw new Error('Usage: npm run admin:bootstrap -- <admin-email>');
  }

  const app = createApp();
  try {
    const hostedTestMode = app.testDeps.env.APP_ENV === 'testing' && app.testDeps.env.NODE_ENV === 'production';
    if (hostedTestMode && !app.testDeps.env.ENABLE_TEST_INTEGRATIONS) {
      throw new Error('Enable guarded TEST integrations before bootstrapping the first hosted test Admin.');
    }
    if (app.testDeps.env.ENABLE_TEST_INTEGRATIONS && normalizeEmail(email) !== normalizeEmail(app.testDeps.env.MAIL_FROM)) {
      throw new Error('The first hosted TEST Admin must use the configured TEST mailbox address.');
    }
    await app.ready();
    await bootstrapFirstAdmin(
      { prisma, mailer: app.testDeps.mailer, webOrigin: app.testDeps.env.WEB_ORIGIN },
      email,
      new Date(),
    );
    console.log('Initial admin invite sent.');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Admin bootstrap failed');
  process.exitCode = 1;
});
