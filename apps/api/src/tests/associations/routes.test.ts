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
  it('stores primary contact details for Admin communications but omits them from public association choices', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/admin/associations',
      payload: { name: 'MENA', primaryContactName: 'Taylor Contact', primaryContactEmail: 'Taylor@Example.Test' },
      cookies: { nt_session: cookie },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ primaryContactName: 'Taylor Contact', primaryContactEmail: 'taylor@example.test' });

    const publicList = await app.inject({ method: 'GET', url: '/api/public/associations' });
    expect(publicList.json()).toEqual([{ id: created.json().id, name: 'MENA', active: true }]);
  });

  it('updates or clears the primary contact as a pair', async () => {
    const created = await prisma.memberAssociation.create({ data: { name: 'MENA' } });
    const updated = await app.inject({
      method: 'PATCH', url: `/api/admin/associations/${created.id}`,
      payload: { primaryContactName: 'Taylor Contact', primaryContactEmail: 'taylor@example.test' },
      cookies: { nt_session: cookie },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ primaryContactName: 'Taylor Contact', primaryContactEmail: 'taylor@example.test' });
    const invalid = await app.inject({
      method: 'PATCH', url: `/api/admin/associations/${created.id}`,
      payload: { primaryContactName: 'Only a name' }, cookies: { nt_session: cookie },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('rejects a duplicate association name', async () => {
    await prisma.memberAssociation.create({ data: { name: 'MENA' } });
    const res = await app.inject({ method: 'POST', url: '/api/admin/associations', payload: { name: 'MENA' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(409);
  });
});
