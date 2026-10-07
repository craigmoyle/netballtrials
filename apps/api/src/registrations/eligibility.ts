export function normalizePlayerName(first: string, last: string): string {
  return `${first} ${last}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ageAtDecember31(dateOfBirth: Date, competitionYear: number): number {
  // 31 December is the last day of the competition year, so the age reached is
  // simply the difference in years.
  return competitionYear - dateOfBirth.getUTCFullYear();
}

export function isAgeInRange(age: number, minAge: number, maxAge: number): boolean {
  return age >= minAge && age <= maxAge;
}
