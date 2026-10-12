import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture } from '../helpers/fixtures';

const app = createApp();
let cookie: string;
let eventId: string;

async function colorId(name: string): Promise<string> {
  const response = await app.inject({ method: 'GET', url: '/api/admin/bib-colors', cookies: { nt_session: cookie } });
  expect(response.statusCode).toBe(200);
  const color = response.json().find((item: { name: string }) => item.name === name);
  if (!color) throw new Error(`missing seeded color ${name}`);
  return color.id;
}

beforeEach(async () => {
  await resetDb();
  eventId = (await prisma.event.create({ data: eventFixture({ courts: 3 }) })).id;
  cookie = await signInAsNewAdmin(app, 'colors-admin@example.com');
});

afterEach(async () => {
  await prisma.eventCourtColor.deleteMany();
  await prisma.bibColor.deleteMany({ where: { name: { startsWith: 'Test ' } } });
});

describe('Admin bib colors', () => {
  it('requires an Admin session for the catalog and event assignments', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/bib-colors' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/court-colors` })).statusCode).toBe(401);
  });

  it('lists the standard color choices with their written name and swatch value', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/bib-colors', cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((color: { name: string; hex: string }) => [color.name, color.hex])).toEqual(expect.arrayContaining([
      ['White', '#FFFFFF'], ['Black', '#111111'], ['Grey', '#808080'], ['Orange', '#F28C28'], ['Red', '#C62828'],
      ['Yellow', '#FDD835'], ['Green', '#2E7D32'], ['Blue', '#1565C0'], ['Purple', '#6A1B9A'], ['Pink', '#D81B60'],
    ]));
  });

  it('creates, edits and archives custom color entries instead of deleting them', async () => {
    const invalid = await app.inject({ method: 'POST', url: '/api/admin/bib-colors', cookies: { nt_session: cookie }, payload: { name: 'Bad', hex: 'orange' } });
    expect(invalid.statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/admin/bib-colors', cookies: { nt_session: cookie }, payload: { name: ' Test Teal ', hex: '#12AB34' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Test Teal', hex: '#12AB34', archivedAt: null });
    const duplicate = await app.inject({ method: 'POST', url: '/api/admin/bib-colors', cookies: { nt_session: cookie }, payload: { name: 'Test Teal', hex: '#ABCDEF' } });
    expect(duplicate.statusCode).toBe(409);

    const edited = await app.inject({ method: 'PATCH', url: `/api/admin/bib-colors/${created.json().id}`, cookies: { nt_session: cookie }, payload: { name: 'Test Sea', hex: '#00AA88' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ name: 'Test Sea', hex: '#00AA88' });
    const archived = await app.inject({ method: 'DELETE', url: `/api/admin/bib-colors/${created.json().id}`, cookies: { nt_session: cookie } });
    expect(archived.statusCode).toBe(204);
    const listed = await app.inject({ method: 'GET', url: '/api/admin/bib-colors', cookies: { nt_session: cookie } });
    expect(listed.json().find((color: { id: string }) => color.id === created.json().id).archivedAt).toBeTruthy();
  });

  it('stores distinct team colors per court and permits reuse on another court', async () => {
    const white = await colorId('White');
    const black = await colorId('Black');
    const grey = await colorId('Grey');
    const orange = await colorId('Orange');
    const before = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/court-colors`, cookies: { nt_session: cookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toHaveLength(3);
    expect(before.json()[2]).toMatchObject({ court: 3, teamAColor: null, teamBColor: null });

    const first = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/court-colors/1`, cookies: { nt_session: cookie }, payload: { teamAColorId: white, teamBColorId: black } });
    const second = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/court-colors/2`, cookies: { nt_session: cookie }, payload: { teamAColorId: white, teamBColorId: orange } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ court: 2, teamAColor: { name: 'White' }, teamBColor: { name: 'Orange' } });

    const same = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/court-colors/3`, cookies: { nt_session: cookie }, payload: { teamAColorId: grey, teamBColorId: grey } });
    expect(same.statusCode).toBe(400);
    const invalidCourt = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/court-colors/4`, cookies: { nt_session: cookie }, payload: { teamAColorId: white, teamBColorId: black } });
    expect(invalidCourt.statusCode).toBe(404);
  });

  it('keeps an archived assigned color readable but will not newly assign it', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/bib-colors', cookies: { nt_session: cookie }, payload: { name: 'Test Teal', hex: '#12AB34' } });
    const black = await colorId('Black');
    const orange = await colorId('Orange');
    const assigned = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/court-colors/1`, cookies: { nt_session: cookie }, payload: { teamAColorId: created.json().id, teamBColorId: black } });
    expect(assigned.statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/bib-colors/${created.json().id}`, cookies: { nt_session: cookie } })).statusCode).toBe(204);

    const existing = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/court-colors`, cookies: { nt_session: cookie } });
    expect(existing.json()[0]).toMatchObject({ teamAColor: { id: created.json().id, name: 'Test Teal', archivedAt: expect.any(String) }, teamBColor: { name: 'Black' } });
    const retained = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/court-colors/1`, cookies: { nt_session: cookie }, payload: { teamAColorId: created.json().id, teamBColorId: orange } });
    expect(retained.statusCode).toBe(200);
    const newAssignment = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/court-colors/2`, cookies: { nt_session: cookie }, payload: { teamAColorId: created.json().id, teamBColorId: black } });
    expect(newAssignment.statusCode).toBe(409);
    expect(newAssignment.json()).toEqual({ error: 'archived_color' });
  });
});
