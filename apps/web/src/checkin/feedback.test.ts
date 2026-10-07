import { describe, it, expect, vi } from 'vitest';
import { announceResult, resultLabel } from './feedback';

describe('check-in feedback', () => {
  it('maps results to tones and never shows review detail', () => {
    expect(resultLabel({ result: 'checked_in', bibNumber: 4, playerName: 'Ada', referToCommittee: false })).toEqual({ tone: 'ok', text: 'Ada, bib 4' });
    expect(resultLabel({ result: 'already', bibNumber: 4, playerName: 'Ada', referToCommittee: false }).tone).toBe('warn');
    expect(resultLabel({ result: 'refused', reason: 'not_paid', referToCommittee: false }).text).toMatch(/not paid/i);
    expect(resultLabel({ result: 'checked_in', bibNumber: 4, playerName: 'Ada', referToCommittee: true }).text).toMatch(/committee/i);
  });
  it('beeps and vibrates', () => {
    const beep = vi.fn();
    const vibrate = vi.fn();
    announceResult({ result: 'checked_in', bibNumber: 1, playerName: 'Ada', referToCommittee: false }, { beep, vibrate });
    expect(beep).toHaveBeenCalledWith(true);
    expect(vibrate).toHaveBeenCalled();
  });
});
