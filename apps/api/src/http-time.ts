import type { FastifyRequest } from 'fastify';

export function requestNow(request: FastifyRequest): Date {
  if (process.env.NODE_ENV !== 'test') return new Date();
  const header = request.headers['x-test-now'];
  return typeof header === 'string' ? new Date(header) : new Date();
}
