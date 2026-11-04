import { describe, expect, it, vi } from 'vitest';
import { rotateTestDatabasePassword, testDatabaseRotationInput } from '../../security/test-db-password-rotation';

const password = 'Synthetic_Rotation_Password_123456789012345678901234567890';

const testEnv = {
  APP_ENV: 'testing',
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://netballtrials_test_api:placeholder@db.example/netballtrials_test?sslmode=require',
  NEW_TEST_DB_PASSWORD: password,
};

describe('hosted TEST database password rotation', () => {
  it('accepts only the hosted TEST database and restricted application role', () => {
    expect(testDatabaseRotationInput(testEnv)).toEqual({ password });
    expect(() => testDatabaseRotationInput({ ...testEnv, APP_ENV: 'production' })).toThrow(/hosted TEST database/i);
    expect(() => testDatabaseRotationInput({ ...testEnv, DATABASE_URL: 'postgresql://user:pass@db.example/production' })).toThrow(/hosted TEST database/i);
    expect(() => testDatabaseRotationInput({ ...testEnv, DATABASE_URL: 'postgresql://admin:pass@db.example/netballtrials_test' })).toThrow(/restricted TEST application role/i);
    expect(() => testDatabaseRotationInput({ ...testEnv, NEW_TEST_DB_PASSWORD: 'short' })).toThrow(/generated URL-safe TEST database password/i);
  });

  it('changes the current role password without interpolating it into SQL text', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ set_config: password }]);
    const executeRawUnsafe = vi.fn().mockResolvedValue(0);
    const transaction = vi.fn(async (work: (tx: unknown) => Promise<void>) => work({ queryRaw, $queryRaw: queryRaw, $executeRawUnsafe: executeRawUnsafe }));
    const prisma = { $transaction: transaction } as any;

    await rotateTestDatabasePassword(prisma, password);

    expect((queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('')).toContain('set_config');
    expect(queryRaw.mock.calls[0]?.[1]).toBe(password);
    expect(executeRawUnsafe).toHaveBeenCalledOnce();
    expect(executeRawUnsafe.mock.calls[0]?.[0]).toContain('current_setting');
    expect(executeRawUnsafe.mock.calls[0]?.[0]).not.toContain(password);
  });
});
