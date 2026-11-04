import 'dotenv/config';
import { prisma } from '../db';
import { loadEnv } from '../env';
import { seedDevSampleDataset } from '../test-data/dev-sample-dataset';
import { isTestDatabaseUrl } from '../validation/database-url';

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.APP_ENV !== 'testing' || env.NODE_ENV !== 'production' || !isTestDatabaseUrl(env.DATABASE_URL)) {
    throw new Error('The sample dataset can only be seeded into a hosted TEST database.');
  }

  const result = await seedDevSampleDataset(prisma);
  console.log(result.status === 'created'
    ? `Created the persistent synthetic TEST dataset with ${result.registrations} registrations.`
    : `The synthetic TEST dataset already exists; left it unchanged (${result.registrations} registrations).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'TEST dataset seeding failed');
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
