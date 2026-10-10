import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, isValidPinFormat } from '../../checkin/pin';

describe('pin', () => {
  it('uses asynchronous scrypt hashing and verification', async () => {
    const hashed = hashPin('4821');
    expect(hashed).toBeInstanceOf(Promise);
    const stored = await hashed;
    const verified = verifyPin('4821', stored);
    expect(verified).toBeInstanceOf(Promise);
    expect(await verified).toBe(true);
  });
  it('verifies the right pin and rejects the wrong one', async () => {
    const stored = await hashPin('4821');
    expect(await verifyPin('4821', stored)).toBe(true);
    expect(await verifyPin('4822', stored)).toBe(false);
  });
  it('accepts 4 to 8 digits only', () => {
    expect(isValidPinFormat('4821')).toBe(true);
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('12ab')).toBe(false);
  });
});
