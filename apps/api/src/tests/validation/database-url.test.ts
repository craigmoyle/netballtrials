import { describe, expect, it } from 'vitest';
import { databaseNameFromUrl, isTestDatabaseUrl } from '../../validation/database-url';

describe('databaseNameFromUrl', () => {
  it('checks the decoded pathname, not query parameters', () => {
    expect(databaseNameFromUrl('postgresql://user:pass@db:5432/netballtrials_test?sslmode=require')).toBe('netballtrials_test');
    expect(isTestDatabaseUrl('postgresql://user:pass@db:5432/netballtrials?application_name=ci_test')).toBe(false);
    expect(isTestDatabaseUrl('postgresql://user:pass@db:5432/netballtrials%5Ftest?sslmode=require')).toBe(true);
  });

  it('rejects missing, malformed, non-Postgres, and pathless URLs', () => {
    for (const value of [undefined, '', 'not a URL', 'https://db.example/netballtrials_test', 'postgresql://db']) {
      expect(databaseNameFromUrl(value)).toBeNull();
      expect(isTestDatabaseUrl(value)).toBe(false);
    }
  });
});
