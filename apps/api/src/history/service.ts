import type { PrismaClient, Position } from '@prisma/client';
import type { PlayerHistoryEntryDTO } from '@netball-trials/types';
import { normalizePlayerName } from '../registrations/eligibility';
import { earliestRetainedEventDate } from '../retention/service';

type HistorySlot = { round: number; court: number; position: Position; team: number; registrationId: string };

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
      event: { is: { eventDate: { gte: earliestRetainedEventDate(now) } } },
    },
    orderBy: [{ event: { eventDate: 'desc' } }, { createdAt: 'desc' }],
    take: 51,
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

  const gamesByEvent = new Map<string, Map<string, { team0: string[]; team1: string[] }>>();
  const slotsByEventPlayer = new Map<string, Map<string, HistorySlot[]>>();
  for (const registration of registrations) {
    if (gamesByEvent.has(registration.event.id)) continue;
    const games = new Map<string, { team0: string[]; team1: string[] }>();
    const slotsByPlayer = new Map<string, HistorySlot[]>();
    for (const slot of registration.event.publishedPlan?.slots ?? []) {
      const key = `${slot.round}:${slot.court}`;
      const game = games.get(key) ?? { team0: [], team1: [] };
      (slot.team === 0 ? game.team0 : game.team1).push(slot.registrationId);
      games.set(key, game);
      const playerSlots = slotsByPlayer.get(slot.registrationId) ?? [];
      playerSlots.push(slot);
      slotsByPlayer.set(slot.registrationId, playerSlots);
    }
    gamesByEvent.set(registration.event.id, games);
    slotsByEventPlayer.set(registration.event.id, slotsByPlayer);
  }

  return registrations.map((registration) => {
    const slots = slotsByEventPlayer.get(registration.event.id)?.get(registration.id) ?? [];
    const games = gamesByEvent.get(registration.event.id) ?? new Map();
    const opposingIds = new Set<string>();
    let repeatOpponentMeetings = 0;
    const priorMeetings = new Map<string, number>();
    for (const slot of slots) {
      const game = games.get(`${slot.round}:${slot.court}`);
      const opponents = slot.team === 0 ? game?.team1 ?? [] : game?.team0 ?? [];
      for (const opponentId of opponents) {
        opposingIds.add(opponentId);
        const count = priorMeetings.get(opponentId) ?? 0;
        if (count > 0) repeatOpponentMeetings += 1;
        priorMeetings.set(opponentId, count + 1);
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
