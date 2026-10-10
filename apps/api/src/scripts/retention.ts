import { prisma } from '../db';
import { anonymizeExpiredRegistrations } from '../retention/service';

async function main(): Promise<void> {
  const count = await anonymizeExpiredRegistrations(prisma, new Date());
  console.log(`retention: anonymised ${count} registrations older than 12 months`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
