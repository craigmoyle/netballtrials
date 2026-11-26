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
    const nameOnly = await app.inject({
      method: 'PATCH', url: `/api/admin/associations/${created.id}`,
      payload: { primaryContactName: 'Updated Contact' }, cookies: { nt_session: cookie },
    });
    expect(nameOnly.statusCode).toBe(200);
    expect(nameOnly.json()).toMatchObject({ primaryContactName: 'Updated Contact', primaryContactEmail: 'taylor@example.test' });
  });

  it('validates a PATCH contact field against the existing contact pair', async () => {
    const created = await prisma.memberAssociation.create({ data: { name: 'MENA', primaryContactName: 'Taylor Contact', primaryContactEmail: 'old@example.test' } });
    const emailOnly = await app.inject({
      method: 'PATCH', url: `/api/admin/associations/${created.id}`, payload: { primaryContactEmail: 'new@example.test' }, cookies: { nt_session: cookie },
    });
    expect(emailOnly.statusCode).toBe(200);
    expect(emailOnly.json()).toMatchObject({ primaryContactName: 'Taylor Contact', primaryContactEmail: 'new@example.test' });

    const clearOnlyName = await app.inject({
      method: 'PATCH', url: `/api/admin/associations/${created.id}`, payload: { primaryContactName: null }, cookies: { nt_session: cookie },
    });
    expect(clearOnlyName.statusCode).toBe(400);
    expect((await prisma.memberAssociation.findUniqueOrThrow({ where: { id: created.id } })).primaryContactName).toBe('Taylor Contact');
  });

  it('enforces the contact pair at the database boundary', async () => {
    const association = await prisma.memberAssociation.create({ data: {
      name: 'Database pair', primaryContactName: 'Morgan', primaryContactEmail: 'morgan@example.test',
    } });
    await expect(prisma.memberAssociation.update({
      where: { id: association.id }, data: { primaryContactName: null },
    })).rejects.toMatchObject({ code: 'P2039' });
  });

  it('rejects a duplicate association name', async () => {
    await prisma.memberAssociation.create({ data: { name: 'MENA' } });
    const res = await app.inject({ method: 'POST', url: '/api/admin/associations', payload: { name: 'MENA' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(409);
  });
});
