export function databaseNameFromUrl(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
    const encodedName = url.pathname.split('/').filter(Boolean).at(-1);
    return encodedName ? decodeURIComponent(encodedName) : null;
  } catch {
    return null;
  }
}

export function isTestDatabaseUrl(databaseUrl: string | undefined): boolean {
  return databaseNameFromUrl(databaseUrl)?.endsWith('_test') ?? false;
}
