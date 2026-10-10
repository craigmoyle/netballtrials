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
