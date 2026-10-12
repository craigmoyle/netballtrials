import type { CheckInResult } from '@netball-trials/types';

export function resultLabel(result: CheckInResult): { tone: 'ok' | 'warn' | 'error'; text: string } {
  if (result.referToCommittee) {
    const player = result.playerName
      ? `${result.playerName}, Number ${result.bibNumber ?? '?'}`
      : result.bibNumber !== undefined ? `Number ${result.bibNumber}` : '';
    return { tone: 'warn', text: player ? `${player} — Refer to committee` : 'Refer to committee' };
  }
  if (result.result === 'checked_in') {
    return { tone: 'ok', text: `${result.playerName ?? 'Player'}, Number ${result.bibNumber ?? '?'}` };
  }
  if (result.result === 'already') {
    return { tone: 'warn', text: `${result.playerName ?? 'Player'}, Number ${result.bibNumber ?? '?'} (already checked in)` };
  }
  if (result.reason === 'not_paid') {
    return { tone: 'error', text: 'Not paid. Send to the desk.' };
  }
  return { tone: 'error', text: 'Unknown code. Try manual lookup.' };
}

export function announceResult(
  result: CheckInResult,
  deps: { beep: (ok: boolean) => void; vibrate: (pattern: number[]) => void },
): void {
  const { tone } = resultLabel(result);
  deps.beep(tone === 'ok');
  deps.vibrate(tone === 'ok' ? [40] : [40, 60, 40]);
}
