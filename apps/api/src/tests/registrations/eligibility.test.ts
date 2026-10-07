import { describe, it, expect } from 'vitest';
import { normalizePlayerName, ageAtDecember31, isAgeInRange } from '../../registrations/eligibility';
import { registrationInputSchema } from '../../registrations/schemas';

describe('normalizePlayerName', () => {
  it('lowercases, strips accents and hyphens, and collapses spaces', () => {
    expect(normalizePlayerName('  Renée-', " O'Hara  Smith ")).toBe('renee ohara smith');
  });
});

describe('ageAtDecember31', () => {
  it('is the age reached by 31 December of the competition year', () => {
    expect(ageAtDecember31(new Date('2011-12-31T00:00:00Z'), 2026)).toBe(15);
    expect(ageAtDecember31(new Date('2012-01-01T00:00:00Z'), 2026)).toBe(14);
  });
});

describe('isAgeInRange', () => {
  it('is inclusive at both ends', () => {
    expect(isAgeInRange(12, 12, 15)).toBe(true);
    expect(isAgeInRange(15, 12, 15)).toBe(true);
    expect(isAgeInRange(11, 12, 15)).toBe(false);
    expect(isAgeInRange(16, 12, 15)).toBe(false);
  });
});

describe('registrationInputSchema', () => {
  const base = {
    playerFirstName: 'Ada', playerLastName: 'Lovelace', dateOfBirth: '2011-04-02',
    parentName: 'Anne', parentEmail: 'anne@example.com', parentMobile: '0400000000',
    memberAssociation: 'MENA', rank1Position: 'GS', optInExtraPositions: false, eligibilityConfirmed: true,
  };
  it('accepts one or two positions', () => {
    expect(registrationInputSchema.safeParse(base).success).toBe(true);
    expect(registrationInputSchema.safeParse({ ...base, rank2Position: 'WA' }).success).toBe(true);
  });
  it('rejects duplicate positions and a false eligibility confirmation', () => {
    expect(registrationInputSchema.safeParse({ ...base, rank2Position: 'GS' }).success).toBe(false);
    expect(registrationInputSchema.safeParse({ ...base, eligibilityConfirmed: false }).success).toBe(false);
  });
});
