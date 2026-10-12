import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EventCourtColors } from './EventCourtColors';

afterEach(cleanup);

const colors = [
  { id: 'white', name: 'White', hex: '#FFFFFF', archivedAt: null },
  { id: 'black', name: 'Black', hex: '#111111', archivedAt: null },
  { id: 'grey', name: 'Grey', hex: '#808080', archivedAt: null },
  { id: 'orange', name: 'Orange', hex: '#F28C28', archivedAt: null },
];

function renderColors(client: Record<string, unknown>) {
  return render(<EventCourtColors client={client as any} eventId="event-1" courts={2} />);
}

describe('EventCourtColors', () => {
  it('shows each court pair and saves a distinct pair for that court', async () => {
    const setCourtColors = vi.fn().mockResolvedValue({
      court: 2, teamAColor: colors[2], teamBColor: colors[3],
    });
    renderColors({
      listBibColors: vi.fn().mockResolvedValue(colors),
      getCourtColors: vi.fn().mockResolvedValue([
        { court: 1, teamAColor: colors[0], teamBColor: colors[1] },
        { court: 2, teamAColor: null, teamBColor: null },
      ]),
      setCourtColors,
    });

    expect(await screen.findByLabelText('Court 1 Team A color')).toHaveValue('white');
    expect(screen.getByLabelText('Court 1 Team B color')).toHaveValue('black');
    expect(screen.getByLabelText('Court 2 Team A color')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Court 2 Team A color'), { target: { value: 'grey' } });
    fireEvent.change(screen.getByLabelText('Court 2 Team B color'), { target: { value: 'orange' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save court 2 colors' }));

    await waitFor(() => expect(setCourtColors).toHaveBeenCalledWith('event-1', 2, { teamAColorId: 'grey', teamBColorId: 'orange' }));
    expect(screen.getByLabelText('Court 2 Team A color')).toHaveValue('grey');
    expect(screen.getByLabelText('Court 2 Team B color')).toHaveValue('orange');
  });

  it('rejects duplicate team colors and keeps an archived assigned color visible', async () => {
    const archived = { id: 'teal', name: 'Test Teal', hex: '#12AB34', archivedAt: '2026-10-01T00:00:00.000Z' };
    const setCourtColors = vi.fn();
    renderColors({
      listBibColors: vi.fn().mockResolvedValue([...colors, archived]),
      getCourtColors: vi.fn().mockResolvedValue([
        { court: 1, teamAColor: archived, teamBColor: colors[0] },
        { court: 2, teamAColor: null, teamBColor: null },
      ]),
      setCourtColors,
    });

    expect(await screen.findByLabelText('Court 1 Team A color')).toHaveValue('teal');
    expect(screen.getByRole('option', { name: 'Test Teal (archived)' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Court 2 Team A color'), { target: { value: 'white' } });
    fireEvent.change(screen.getByLabelText('Court 2 Team B color'), { target: { value: 'white' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save court 2 colors' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/team a and team b colors must be different/i);
    expect(setCourtColors).not.toHaveBeenCalled();
  });
});
