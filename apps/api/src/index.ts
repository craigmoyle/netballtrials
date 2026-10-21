import 'dotenv/config';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';

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

app
  .listen({ port: app.testDeps.env.PORT, host: '0.0.0.0' })
  .catch((err) => {
    app.log.error(err);
    if (!app.log.level || app.log.level === 'silent') startupFailed(err);
    process.exit(1);
  });
