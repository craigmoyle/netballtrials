import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { validateWindow } from '../../events/schemas';
import { createEvent, listEvents, updateEvent } from '../../events/service';

const base = {
  name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2026-09-12', venue: 'State Netball Centre', startTime: '08:30', endTime: '12:00',
  firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 5,
  rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2, minAge: 12, maxAge: 15,
};

beforeEach(resetDb);

describe('validateWindow', () => {
  it('accepts ordered times', () => {
    expect(validateWindow(base)).toEqual([]);
  });
  it('names the field when the whistles are reversed', () => {
    expect(validateWindow({ ...base, lastWhistle: '08:45' })).toContain('lastWhistle');
  });
  it('names the field when the first whistle precedes arrival', () => {
    expect(validateWindow({ ...base, firstWhistle: '08:00' })).toContain('firstWhistle');
  });
});

describe('event service', () => {
  it('creates, lists, and updates an event', async () => {
    const created = await createEvent(prisma, base);
    expect(await listEvents(prisma)).toHaveLength(1);
    const updated = await updateEvent(prisma, created.id, { courts: 4 });
    expect(updated?.courts).toBe(4);
  });
  it('rejects an event with fewer than one court at the schema level', async () => {
    const { createEvent: create } = await import('../../events/service');
    await expect(create(prisma, { ...base, courts: 0 } as any)).rejects.toThrow();
  });
});
