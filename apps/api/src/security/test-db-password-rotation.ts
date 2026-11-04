import type { PrismaClient } from '@prisma/client';
import { isTestDatabaseUrl } from '../validation/database-url';

export function testDatabaseRotationInput(env: NodeJS.ProcessEnv): { password: string } {
  if (env.APP_ENV !== 'testing' || env.NODE_ENV !== 'production' || !isTestDatabaseUrl(env.DATABASE_URL)) {
    throw new Error('Database password rotation is restricted to the hosted TEST database.');
  }
  if (!env.NEW_TEST_DB_PASSWORD || !/^[A-Za-z0-9_-]{48,128}$/.test(env.NEW_TEST_DB_PASSWORD)) {
    throw new Error('Provide a generated URL-safe TEST database password.');
  }
  const databaseUrl = new URL(env.DATABASE_URL!);
  if (decodeURIComponent(databaseUrl.username) !== 'netballtrials_test_api') {
    throw new Error('Database password rotation requires the restricted TEST application role.');
  }
  return { password: env.NEW_TEST_DB_PASSWORD };
}

export async function rotateTestDatabasePassword(prisma: PrismaClient, password: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('netballtrials.test_db_password', ${password}, true)`;
    await tx.$executeRawUnsafe(`DO $netballtrials$ BEGIN EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', current_user, current_setting('netballtrials.test_db_password')); END $netballtrials$`);
  });
}
