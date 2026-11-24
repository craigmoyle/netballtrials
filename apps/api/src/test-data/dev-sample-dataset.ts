import type { Prisma, PrismaClient } from '@prisma/client';
import { sampleAssociations, sampleRegistration } from './sample-registrations';

export const DEV_SAMPLE_EVENT_ID = 'dev-sample-2027-15u-ladies';

const confirmedAt = new Date('2026-10-01T00:00:00.000Z');

export async function seedDevSampleDataset(prisma: PrismaClient): Promise<{
  status: 'created' | 'already_present';
  registrations: number;
}> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findUnique({ where: { id: DEV_SAMPLE_EVENT_ID }, select: { id: true } });
    if (existing) {
      return { status: 'already_present', registrations: await tx.registration.count({ where: { eventId: DEV_SAMPLE_EVENT_ID } }) };
    }

    await tx.memberAssociation.createMany({
      data: sampleAssociations.map((association) => ({ ...association, active: true })),
      skipDuplicates: true,
    });
    await tx.event.create({
      data: {
        id: DEV_SAMPLE_EVENT_ID,
        name: 'DEV sample 15/U Ladies',
        competitionYear: 2027,
        division: '15/U',
        section: 'Ladies',
        eventDate: new Date('2027-09-12T00:00:00.000Z'),
        venue: 'SNC',
        startTime: '08:30',
        endTime: '12:00',
        gameStartTime: '09:00',
        registrationFeeCents: 3500,
        courts: 3,
        rank1Min: 2,
        rank2Min: 1,
        rank3Min: 0,
        playMinutes: 8,
        changeoverMinutes: 2,
        minAge: 12,
        maxAge: 15,
        status: 'OPEN',
        nextBibNumber: 70,
      },
    });

    const [white, black, grey, orange] = await Promise.all(['White', 'Black', 'Grey', 'Orange'].map((name) =>
      tx.bibColor.findUniqueOrThrow({ where: { name }, select: { id: true } }),
    ));
    await tx.eventCourtColor.createMany({ data: [
      { eventId: DEV_SAMPLE_EVENT_ID, court: 1, teamAColorId: white.id, teamBColorId: black.id },
      { eventId: DEV_SAMPLE_EVENT_ID, court: 2, teamAColorId: grey.id, teamBColorId: orange.id },
      { eventId: DEV_SAMPLE_EVENT_ID, court: 3, teamAColorId: white.id, teamBColorId: orange.id },
    ] });

    const registrations: Prisma.RegistrationCreateManyInput[] = Array.from({ length: 70 }, (_, index) => {
      const sample = sampleRegistration(index);
      const isWaiting = index === 0;
      return {
        eventId: DEV_SAMPLE_EVENT_ID,
        playerFirstName: sample.playerFirstName,
        playerLastName: sample.playerLastName,
        playerNameNormalized: sample.playerNameNormalized,
        parentName: `Sample Parent ${index + 1}`,
        parentEmail: sample.isTicketPlayer ? 'parent1@example.test' : `parent${index + 1}@example.test`,
        parentMobile: '0400000000',
        dateOfBirth: new Date('2012-04-02T00:00:00.000Z'),
        memberAssociation: sample.association.name,
        rank1Position: sample.rank1Position,
        rank2Position: sample.rank2Position,
        rank3Position: sample.rank3Position,
        optInExtraPositions: index < 7,
        eligibilityConfirmedAt: confirmedAt,
        parentAuthorityConfirmedAt: confirmedAt,
        parentEmailVerifiedAt: confirmedAt,
        status: 'PAID',
        amountCents: 3500,
        paidAt: confirmedAt,
        policyReference: 'https://chisholmnetball.com/selection-policy/',
        ageFlagged: index < 2,
        qrToken: sample.isTicketPlayer ? 'dev-sample-ticket-token-0123456789abcdef' : `dev-sample-token-${index}-abcdefghijklmnopqrstuvwxyz`,
        checkedInAt: isWaiting ? null : new Date('2027-09-12T00:00:00.000Z'),
        checkedInBy: isWaiting ? null : 'DEV sample volunteer',
        bibNumber: isWaiting ? null : index,
        expiresAt: new Date('2027-09-11T00:00:00.000Z'),
      };
    });
    await tx.registration.createMany({ data: registrations });
    return { status: 'created', registrations: registrations.length };
  });
}
