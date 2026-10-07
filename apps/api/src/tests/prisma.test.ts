import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../db';
import { resetDb } from './helpers/db';

describe('StaffUser persistence', () => {
  beforeEach(resetDb);
  it('stores and reads an admin by unique email', async () => {
    await prisma.staffUser.create({ data: { email: 'craig@example.com', role: 'ADMIN' } });
    const found = await prisma.staffUser.findUnique({ where: { email: 'craig@example.com' } });
    expect(found?.role).toBe('ADMIN');
  });
});
