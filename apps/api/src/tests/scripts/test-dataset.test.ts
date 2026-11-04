import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { seedDevSampleDataset, DEV_SAMPLE_EVENT_ID } from '../../test-data/dev-sample-dataset';

beforeEach(resetDb);

describe('one-time TEST dataset', () => {
  it('creates only synthetic, verified sample registrations and no Admin accounts', async () => {
    await expect(seedDevSampleDataset(prisma)).resolves.toEqual({ status: 'created', registrations: 70 });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: DEV_SAMPLE_EVENT_ID } });
    const registrations = await prisma.registration.findMany({ where: { eventId: event.id } });

    expect(event.name).toBe('DEV sample 15/U Ladies');
    expect(registrations).toHaveLength(70);
    expect(registrations.every((registration) => registration.parentEmail.endsWith('@example.test'))).toBe(true);
    expect(registrations.every((registration) => registration.parentEmailVerifiedAt && registration.parentAuthorityConfirmedAt && registration.paidAt)).toBe(true);
    expect(await prisma.staffUser.count()).toBe(0);
  });

  it('does not refresh or duplicate the dataset when run again', async () => {
    await seedDevSampleDataset(prisma);
    await prisma.event.update({ where: { id: DEV_SAMPLE_EVENT_ID }, data: { name: 'Locally edited sample' } });

    await expect(seedDevSampleDataset(prisma)).resolves.toEqual({ status: 'already_present', registrations: 70 });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: DEV_SAMPLE_EVENT_ID } })).name).toBe('Locally edited sample');
    expect(await prisma.registration.count({ where: { eventId: DEV_SAMPLE_EVENT_ID } })).toBe(70);
  });
});
