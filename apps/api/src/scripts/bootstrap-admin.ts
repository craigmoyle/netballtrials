import 'dotenv/config';
import { createApp } from '../app';
import { bootstrapFirstAdmin } from '../auth/service';
import { prisma } from '../db';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    throw new Error('Usage: npm run admin:bootstrap -- <admin-email>');
  }

  const app = createApp();
  try {
    if (app.testDeps.integrationSettings?.mode === 'infisical') await app.testDeps.reloadIntegrations?.();
    if (app.testDeps.env.APP_ENV === 'production' && (!('provider' in app.testDeps.mailer) || app.testDeps.mailer.provider !== 'gmail-api')) {
      throw new Error('Production admin bootstrap requires configured Gmail credentials.');
    }
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
