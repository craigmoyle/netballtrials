import type { BibColor, PrismaClient } from '@prisma/client';
import type { BibColorDTO, EventCourtColorDTO } from '@netball-trials/types';

export class BibColorNotFoundError extends Error {}
export class BibColorArchivedError extends Error {}
export class BibColorValidationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super('Invalid bib color');
    this.name = 'BibColorValidationError';
    this.fields = fields;
  }
}

function toDTO(color: BibColor): BibColorDTO {
  return { id: color.id, name: color.name, hex: color.hex, archivedAt: color.archivedAt?.toISOString() ?? null };
}

export async function listBibColors(prisma: PrismaClient): Promise<BibColorDTO[]> {
  const colors = await prisma.bibColor.findMany({ orderBy: { name: 'asc' } });
  return colors.map(toDTO);
}

export async function createBibColor(
  prisma: PrismaClient,
  input: { name: string; hex: string },
): Promise<BibColorDTO> {
  const color = await prisma.bibColor.create({ data: { name: input.name.trim(), hex: input.hex } });
  return toDTO(color);
}

export async function updateBibColor(
  prisma: PrismaClient,
  id: string,
  patch: { name?: string; hex?: string },
): Promise<BibColorDTO | null> {
  const existing = await prisma.bibColor.findUnique({ where: { id } });
  if (!existing) return null;
  const color = await prisma.bibColor.update({
    where: { id },
    data: { ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.hex !== undefined ? { hex: patch.hex } : {}) },
  });
  return toDTO(color);
}

export async function archiveBibColor(prisma: PrismaClient, id: string, now = new Date()): Promise<boolean> {
  const changed = await prisma.bibColor.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: now } });
  return changed.count === 1 || Boolean(await prisma.bibColor.findUnique({ where: { id }, select: { id: true } }));
}

type EventCourtColorWithColors = {
  court: number;
  teamAColor: BibColor;
  teamBColor: BibColor;
};

function courtColorDTO(row: EventCourtColorWithColors | null, court: number): EventCourtColorDTO {
  return {
    court,
    teamAColor: row ? toDTO(row.teamAColor) : null,
    teamBColor: row ? toDTO(row.teamBColor) : null,
  };
}

export async function getEventCourtColors(prisma: PrismaClient, eventId: string): Promise<EventCourtColorDTO[] | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      courts: true,
      courtColors: { include: { teamAColor: true, teamBColor: true }, orderBy: { court: 'asc' } },
    },
  });
  if (!event) return null;
  const byCourt = new Map(event.courtColors.map((row) => [row.court, row]));
  return Array.from({ length: event.courts }, (_, index) => courtColorDTO(byCourt.get(index + 1) ?? null, index + 1));
}

export async function setEventCourtColors(
  prisma: PrismaClient,
  eventId: string,
  court: number,
  pair: { teamAColorId: string; teamBColorId: string },
): Promise<EventCourtColorDTO | null> {
  if (pair.teamAColorId === pair.teamBColorId) throw new BibColorValidationError(['teamBColorId']);
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { courts: true } });
    if (!event || court < 1 || court > event.courts) return null;
    const key = { eventId_court: { eventId, court } };
    const existing = await tx.eventCourtColor.findUnique({ where: key, select: { teamAColorId: true, teamBColorId: true } });
    const [teamAColor, teamBColor] = await Promise.all([
      tx.bibColor.findUnique({ where: { id: pair.teamAColorId } }),
      tx.bibColor.findUnique({ where: { id: pair.teamBColorId } }),
    ]);
    if (!teamAColor || !teamBColor) throw new BibColorNotFoundError();
    if (teamAColor.archivedAt && teamAColor.id !== existing?.teamAColorId) throw new BibColorArchivedError();
    if (teamBColor.archivedAt && teamBColor.id !== existing?.teamBColorId) throw new BibColorArchivedError();

    const row = await tx.eventCourtColor.upsert({
      where: key,
      create: { eventId, court, ...pair },
      update: pair,
      include: { teamAColor: true, teamBColor: true },
    });
    return courtColorDTO(row, court);
  });
}
