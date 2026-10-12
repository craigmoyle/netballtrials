import { describe, it, expect, vi } from 'vitest';
import { announceResult, resultLabel } from './feedback';

describe('check-in feedback', () => {
  it('maps results to tones and never shows review detail', () => {
    expect(resultLabel({ result: 'checked_in', bibNumber: 4, playerName: 'Ada', referToCommittee: false })).toEqual({ tone: 'ok', text: 'Ada, Number 4' });
    expect(resultLabel({ result: 'already', bibNumber: 4, playerName: 'Ada', referToCommittee: false })).toEqual({ tone: 'warn', text: 'Ada, Number 4 (already checked in)' });
    expect(resultLabel({ result: 'refused', reason: 'not_paid', referToCommittee: false }).text).toMatch(/not paid/i);
    expect(resultLabel({ result: 'checked_in', bibNumber: 4, playerName: 'Ada', referToCommittee: true }).text).toMatch(/committee/i);
  });
  it('keeps the player name and bib visible when referring to committee', () => {
    expect(resultLabel({ result: 'checked_in', playerName: 'Ada Lovelace', bibNumber: 4, referToCommittee: true })).toEqual({
      tone: 'warn', text: 'Ada Lovelace, Number 4 — Refer to committee',
    });
  });
  it('beeps and vibrates', () => {
    const beep = vi.fn();
    const vibrate = vi.fn();
    announceResult({ result: 'checked_in', bibNumber: 1, playerName: 'Ada', referToCommittee: false }, { beep, vibrate });
    expect(beep).toHaveBeenCalledWith(true);
    expect(vibrate).toHaveBeenCalled();
  });
});
