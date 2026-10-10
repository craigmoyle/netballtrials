import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';

const app = createApp();
beforeEach(resetDb);

describe('public member associations', () => {
  it('lists active choices without requiring an admin session', async () => {
    await prisma.memberAssociation.createMany({ data: [
      { name: 'Active Club', active: true },
      { name: 'Closed Club', active: false },
    ] });
    const response = await app.inject({ method: 'GET', url: '/api/public/associations' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ name: 'Active Club', active: true }),
    ]);
  });
});
