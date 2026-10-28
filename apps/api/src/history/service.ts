import type { PrismaClient, Position } from '@prisma/client';
import type { PlayerHistoryEntryDTO } from '@netball-trials/types';
import { normalizePlayerName } from '../registrations/eligibility';
import { isPastRetentionCutoff } from '../retention/service';

export async function searchPlayerHistory(
  prisma: PrismaClient,
  playerName: string,
  dateOfBirth: string,
  now = new Date(),
): Promise<PlayerHistoryEntryDTO[]> {
  const normalized = normalizePlayerName(playerName, '');
  const registrations = await prisma.registration.findMany({
    where: {
      playerNameNormalized: normalized,
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
      anonymizedAt: null,
    },
    orderBy: [{ event: { eventDate: 'asc' } }, { createdAt: 'asc' }],
    take: 50,
    select: {
      id: true,
      playerFirstName: true,
      playerLastName: true,
      memberAssociation: true,
      rank1Position: true,
      rank2Position: true,
      rank3Position: true,
      status: true,
      checkedInAt: true,
      bibNumber: true,
      ageFlagged: true,
      event: {
        select: {
          id: true,
          name: true,
          eventDate: true,
          competitionYear: true,
          division: true,
          section: true,
          publishedPlan: { select: { slots: { select: { round: true, court: true, position: true, team: true, registrationId: true } } } },
        },
      },
    },
  });

  return registrations.filter((registration) => !isPastRetentionCutoff(registration.event.eventDate, now)).map((registration) => {
    const slots = registration.event.publishedPlan?.slots.filter((slot) => slot.registrationId === registration.id) ?? [];
    const opposingIds = new Set<string>();
    let repeatOpponentMeetings = 0;
    const priorMeetings = new Map<string, number>();
    for (const slot of slots) {
      const opponents = registration.event.publishedPlan?.slots.filter((candidate) =>
        candidate.round === slot.round && candidate.court === slot.court && candidate.team !== slot.team,
      ) ?? [];
      for (const opponent of opponents) {
        opposingIds.add(opponent.registrationId);
        const count = priorMeetings.get(opponent.registrationId) ?? 0;
        if (count > 0) repeatOpponentMeetings += 1;
        priorMeetings.set(opponent.registrationId, count + 1);
      }
    }
    const courtsSeen = [...new Set(slots.map((slot) => slot.court))].sort((a, b) => a - b);
    const positionsPlayed: Partial<Record<Position, number>> = {};
    for (const slot of slots) positionsPlayed[slot.position] = (positionsPlayed[slot.position] ?? 0) + 1;
    return {
      registrationId: registration.id,
      playerName: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
      eventId: registration.event.id,
      eventName: registration.event.name,
      eventDate: registration.event.eventDate.toISOString().slice(0, 10),
      competitionYear: registration.event.competitionYear,
      division: registration.event.division,
      section: registration.event.section,
      association: registration.memberAssociation,
      rank1Position: registration.rank1Position,
      rank2Position: registration.rank2Position,
      rank3Position: registration.rank3Position,
      registrationStatus: registration.status,
      checkedIn: registration.checkedInAt !== null,
      number: registration.bibNumber,
      ageFlagged: registration.ageFlagged,
      games: slots.length,
      courtsSeen,
      positionsPlayed,
      uniqueOpponents: opposingIds.size,
      repeatOpponentMeetings,
    };
  });
}
