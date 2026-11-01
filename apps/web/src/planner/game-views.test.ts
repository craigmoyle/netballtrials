import { describe, expect, it } from 'vitest';
import { GAME_VIEWS, gameViewFromSearch } from './game-views';

describe('planning game views', () => {
  it('maps route query values to the named views and defaults to Full Game List', () => {
    expect(GAME_VIEWS.map(({ label }) => label)).toEqual(['Full Game List', 'Position View', 'Player Statistics', 'Player Reference']);
    expect(gameViewFromSearch('')).toBe('team');
    expect(gameViewFromSearch('?view=position')).toBe('position');
    expect(gameViewFromSearch('?view=statistics')).toBe('statistics');
    expect(gameViewFromSearch('?view=reference')).toBe('reference');
    expect(gameViewFromSearch('?view=unknown')).toBe('team');
  });
});
