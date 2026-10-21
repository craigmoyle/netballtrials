import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;

function derive(pin: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, length, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(pin, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex || !/^[\da-f]{32}$/i.test(saltHex) || !/^[\da-f]{64}$/i.test(hashHex)) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await derive(pin, salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

/** Format required when an admin sets a new PIN. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{6,8}$/.test(pin);
}

/** Format accepted at login; 4-digit PINs set before the 6-digit minimum still verify. */
export function isPinInput(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}
