import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { isTestDatabaseUrl } from '../validation/database-url';

config({ path: '.env.test' });

export default function setup(): void {
  if (!isTestDatabaseUrl(process.env.DATABASE_URL)) {
    throw new Error('Refusing to run tests: DATABASE_URL must name a database ending in _test. Check apps/api/.env.test.');
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: 'inherit',
  });
}
