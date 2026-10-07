export function eventFixture(overrides: Record<string, unknown> = {}) {
  return {
    name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
    eventDate: new Date('2026-09-12T00:00:00.000Z'), venue: 'SNC', startTime: '08:30', endTime: '12:00',
    firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 5,
    rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2,
    minAge: 12, maxAge: 15, ...overrides,
  };
}

export function registrationFixture(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    eventId, playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
    dateOfBirth: new Date('2011-04-02T00:00:00.000Z'), parentName: 'Anne', parentEmail: 'anne@example.com',
    parentMobile: '0400000000', memberAssociation: 'MENA', rank1Position: 'GS' as const,
    eligibilityConfirmedAt: new Date('2026-08-01T00:00:00.000Z'),
    amountCents: 3500, policyReference: 'https://chisholmnetball.com/selection-policy/',
    expiresAt: new Date(Date.now() + 86_400_000), ...overrides,
  };
}
