import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadEnv, type Env } from './env';

export function createApp(env: Env = loadEnv()): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(cors, { origin: env.WEB_ORIGIN });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
