import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';

config({ path: '.env.test' });

export default function setup(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(
      `Refusing to run tests against a non-test database: ${url || '(unset)'}. Check apps/api/.env.test.`,
    );
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: 'inherit',
  });
}
