import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, isValidPinFormat, isPinInput } from '../../checkin/pin';

describe('pin', () => {
  it('uses asynchronous scrypt hashing and verification', async () => {
    const hashed = hashPin('482193');
    expect(hashed).toBeInstanceOf(Promise);
    const stored = await hashed;
    const verified = verifyPin('482193', stored);
    expect(verified).toBeInstanceOf(Promise);
    expect(await verified).toBe(true);
  });
  it('verifies the right pin and rejects the wrong one', async () => {
    const stored = await hashPin('482193');
    expect(await verifyPin('482193', stored)).toBe(true);
    expect(await verifyPin('482194', stored)).toBe(false);
  });
  it('still verifies an existing 4-digit pin hash', async () => {
    const legacy = await hashPin('4821');
    expect(await verifyPin('4821', legacy)).toBe(true);
  });
  it('requires 6 to 8 digits for a new pin', () => {
    expect(isValidPinFormat('482193')).toBe(true);
    expect(isValidPinFormat('48219312')).toBe(true);
    expect(isValidPinFormat('4821')).toBe(false);
    expect(isValidPinFormat('48219')).toBe(false);
    expect(isValidPinFormat('482193123')).toBe(false);
    expect(isValidPinFormat('12ab56')).toBe(false);
  });
  it('accepts 4 to 8 digit strings as login input', () => {
    expect(isPinInput('4821')).toBe(true);
    expect(isPinInput('48219312')).toBe(true);
    expect(isPinInput('123')).toBe(false);
    expect(isPinInput('482193123')).toBe(false);
    expect(isPinInput('12ab')).toBe(false);
  });
});
