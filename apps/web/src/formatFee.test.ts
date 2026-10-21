import { describe, expect, it } from 'vitest';
import { formatFee } from './formatFee';

describe('formatFee', () => {
  it('formats cents in the given currency for en-AU', () => {
    expect(formatFee(3500, 'aud')).toBe('$35.00');
    expect(formatFee(0, 'AUD')).toBe('$0.00');
  });
});
