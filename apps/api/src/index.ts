import 'dotenv/config';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { prisma } from './db';

function startupFailed(error: unknown): never {
  // Configuration errors happen before the logger exists, so always write to stderr.
  console.error(`API startup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}

let app: FastifyInstance;
try {
  app = createApp();
} catch (error) {
  startupFailed(error);
}

let shutdown: Promise<void> | null = null;
async function closeServer(): Promise<void> {
  shutdown ??= (async () => {
    try { await app.close(); }
    catch (error) { app.log.error(error, 'API shutdown failed'); process.exitCode = 1; }
    try { await prisma.$disconnect(); }
    catch (error) { app.log.error(error, 'Database shutdown failed'); process.exitCode = 1; }
  })();
  await shutdown;
}

process.once('SIGINT', () => { void closeServer(); });
process.once('SIGTERM', () => { void closeServer(); });

app
  .listen({ port: app.testDeps.env.PORT, host: '0.0.0.0' })
  .catch((err) => {
    app.log.error(err);
    if (!app.log.level || app.log.level === 'silent') startupFailed(err);
    process.exitCode = 1;
    void closeServer();
  });
