import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { exportRosterCsv, getRoster } from '../../roster/service';

beforeEach(resetDb);

describe('admin roster service', () => {
  it('returns limited roster rows and rank/extra-position counts', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await prisma.registration.create({
      data: registrationFixture(event.id, { rank1Position: 'GS', rank2Position: 'WA', optInExtraPositions: true, status: 'PAID', bibNumber: 6 }),
    });
    const roster = await getRoster(prisma, event.id);
    expect(roster?.positionCounts).toMatchObject({ rank1: { GS: 1 }, rank2: { WA: 1 }, extraOptIn: 1 });
    expect(roster?.registrations[0]).toMatchObject({ playerName: 'Ada Lovelace', parentEmail: 'anne@example.com', bibNumber: 6 });
  });

  it('exports a quoted formula-neutralized CSV only before the calendar cutoff', async () => {
    const event = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2026-10-10T00:00:00Z') }) });
    await prisma.registration.create({ data: registrationFixture(event.id, { playerFirstName: '=SUM(1)', playerLastName: 'Ng, Jr', parentName: '@cmd', playerNameNormalized: 'formula ng', memberAssociation: 'Ng, Jr', status: 'PAID' }) });
    const exportFile = await exportRosterCsv(prisma, event.id, new Date('2026-10-10T00:00:00Z'));
    expect(exportFile?.csv).toContain("'=SUM(1)");
    expect(exportFile?.csv).toContain("'@cmd");
    expect(exportFile?.csv).toContain('"Ng, Jr"');
    expect(await exportRosterCsv(prisma, event.id, new Date('2027-10-10T13:00:00Z'))).toBeNull();
  });
});
