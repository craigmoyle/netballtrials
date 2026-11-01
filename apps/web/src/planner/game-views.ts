export const GAME_VIEWS = [
  { id: 'team', label: 'Full Game List', search: '' },
  { id: 'position', label: 'Position View', search: '?view=position' },
  { id: 'statistics', label: 'Player Statistics', search: '?view=statistics' },
  { id: 'reference', label: 'Player Reference', search: '?view=reference' },
] as const;

export type GameView = (typeof GAME_VIEWS)[number]['id'];

export function gameViewFromSearch(search: string): GameView {
  const value = new URLSearchParams(search).get('view');
  return GAME_VIEWS.find((view) => view.id === value)?.id ?? 'team';
}
