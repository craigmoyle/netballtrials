import { describe, expect, it, vi } from 'vitest';
import { expireStripeCheckout } from '../../payments/stripe';

describe('expireStripeCheckout', () => {
  it('returns true when Stripe expires an open session', async () => {
    const sessions = {
      expire: vi.fn().mockResolvedValue({ status: 'expired' }),
      retrieve: vi.fn(),
    };
    await expect(expireStripeCheckout(sessions, 'cs_open')).resolves.toBe(true);
    expect(sessions.expire).toHaveBeenCalledWith('cs_open');
    expect(sessions.retrieve).not.toHaveBeenCalled();
  });

  it('returns false when the session already completed', async () => {
    const sessions = {
      expire: vi.fn().mockRejectedValue(new Error('already completed')),
      retrieve: vi.fn().mockResolvedValue({ status: 'complete' }),
    };
    await expect(expireStripeCheckout(sessions, 'cs_complete')).resolves.toBe(false);
  });

  it('confirms an already-expired session after a lost response', async () => {
    const sessions = {
      expire: vi.fn().mockRejectedValue(new Error('connection lost')),
      retrieve: vi.fn().mockResolvedValue({ status: 'expired' }),
    };
    await expect(expireStripeCheckout(sessions, 'cs_expired')).resolves.toBe(true);
  });

  it('rethrows provider errors when Stripe cannot confirm the session state', async () => {
    const error = new Error('Stripe unavailable');
    const sessions = {
      expire: vi.fn().mockRejectedValue(error),
      retrieve: vi.fn().mockRejectedValue(new Error('also unavailable')),
    };
    await expect(expireStripeCheckout(sessions, 'cs_unknown')).rejects.toThrow('also unavailable');
  });
});
