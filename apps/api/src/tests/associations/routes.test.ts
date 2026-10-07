import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
});

describe('association admin routes', () => {
  it('requires an admin session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/associations' });
    expect(res.statusCode).toBe(401);
  });
  it('creates and lists associations', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/associations', payload: { name: 'MENA' }, cookies: { nt_session: cookie } });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({ method: 'GET', url: '/api/admin/associations', cookies: { nt_session: cookie } });
    expect(listed.json()).toHaveLength(1);
  });
  it('rejects a duplicate association name', async () => {
    await prisma.memberAssociation.create({ data: { name: 'MENA' } });
    const res = await app.inject({ method: 'POST', url: '/api/admin/associations', payload: { name: 'MENA' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(409);
  });
});
