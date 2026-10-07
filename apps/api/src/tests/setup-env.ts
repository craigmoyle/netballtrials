import { config } from 'dotenv';

// Test workers do not inherit the CLI's dotenv loading, so load the test
// environment (including DATABASE_URL) before any module instantiates Prisma.
config({ path: '.env.test' });
