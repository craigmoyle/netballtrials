import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { getRegistrationOverview } from './overview';

export function registerRegistrationOverviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/registration-overview', { preHandler: requireAdmin(deps) }, async () =>
    getRegistrationOverview(deps.prisma, new Date()),
  );
}
