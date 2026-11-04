import { prisma } from '../db';
import { rotateTestDatabasePassword, testDatabaseRotationInput } from '../security/test-db-password-rotation';

async function main(): Promise<void> {
  const { password } = testDatabaseRotationInput(process.env);
  await rotateTestDatabasePassword(prisma, password);
  console.log('Rotated the restricted TEST database role password.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'TEST database password rotation failed');
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
