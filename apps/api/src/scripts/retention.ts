import 'dotenv/config';
import { prisma } from '../db';
import { anonymizeExpiredRegistrations } from '../retention/service';

async function main(): Promise<void> {
  const count = await anonymizeExpiredRegistrations(prisma, new Date());
  console.log(`retention: anonymised ${count} registrations past the 12-calendar-month cutoff`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : 'Retention job failed');
    await prisma.$disconnect();
    process.exitCode = 1;
  });
