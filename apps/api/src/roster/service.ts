import type { PrismaClient, Position } from '@prisma/client';
import type { RosterDTO, RosterRegistrationDTO } from '@netball-trials/types';
import { isPastRetentionCutoff } from '../retention/service';

const ACTIVE_STATUSES = ['PENDING', 'PAID'] as const;

function countPositions(rows: Array<{ rank1Position: Position; rank2Position: Position | null; rank3Position: Position | null; optInExtraPositions: boolean }>) {
  const count = (rank: 'rank1Position' | 'rank2Position' | 'rank3Position') =>
    rows.reduce<Partial<Record<Position, number>>>((counts, row) => {
      const position = row[rank];
      if (position) counts[position] = (counts[position] ?? 0) + 1;
      return counts;
    }, {});
  return {
    rank1: count('rank1Position'),
    rank2: count('rank2Position'),
    rank3: count('rank3Position'),
    extraOptIn: rows.filter((row) => row.optInExtraPositions).length,
  };
}

export async function getRoster(prisma: PrismaClient, eventId: string): Promise<RosterDTO | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return null;
  const rows = await prisma.registration.findMany({
    where: { eventId, anonymizedAt: null },
    orderBy: [{ playerLastName: 'asc' }, { playerFirstName: 'asc' }],
    select: {
      id: true, playerFirstName: true, playerLastName: true, dateOfBirth: true,
      parentName: true, parentEmail: true, parentMobile: true, memberAssociation: true,
      rank1Position: true, rank2Position: true, rank3Position: true, optInExtraPositions: true,
      ageFlagged: true, status: true, amountCents: true, currency: true, bibNumber: true, checkedInAt: true,
    },
  });
  const activeRows = rows.filter((row) => ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number]));
  const registrations: RosterRegistrationDTO[] = rows.map((row) => ({
    id: row.id,
    playerName: [row.playerFirstName, row.playerLastName].filter(Boolean).join(' '),
    dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
    parentName: row.parentName,
    parentEmail: row.parentEmail,
    parentMobile: row.parentMobile,
    memberAssociation: row.memberAssociation,
    rank1Position: row.rank1Position,
    rank2Position: row.rank2Position,
    rank3Position: row.rank3Position,
    optInExtraPositions: row.optInExtraPositions,
    ageFlagged: row.ageFlagged,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    bibNumber: row.bibNumber,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
  }));
  return { eventId, registrations, positionCounts: countPositions(activeRows) };
}

function csvCell(value: string | number | boolean | null): string {
  let raw = value === null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(raw)) raw = `'${raw}`;
  return `"${raw.replaceAll('"', '""')}"`;
}

const CSV_HEADERS = [
  'Player name', 'Date of birth', 'Parent/guardian', 'Email', 'Mobile', 'Association',
  'Rank 1', 'Rank 2', 'Rank 3', 'Opt in to extra positions', 'Review flagged',
  'Registration status', 'Amount (cents)', 'Currency', 'Bib number', 'Checked in at',
];

export async function exportRosterCsv(
  prisma: PrismaClient,
  eventId: string,
  now = new Date(),
): Promise<{ csv: string; filename: string } | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, eventDate: true } });
  if (!event || isPastRetentionCutoff(event.eventDate, now)) return null;
  const roster = await getRoster(prisma, eventId);
  if (!roster) return null;
  const rows = [CSV_HEADERS, ...roster.registrations.map((row) => [
    row.playerName, row.dateOfBirth, row.parentName, row.parentEmail, row.parentMobile, row.memberAssociation,
    row.rank1Position, row.rank2Position, row.rank3Position, row.optInExtraPositions, row.ageFlagged,
    row.status, row.amountCents, row.currency, row.bibNumber, row.checkedInAt,
  ])];
  return {
    csv: `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
    filename: `roster-${event.id}.csv`,
  };
}
