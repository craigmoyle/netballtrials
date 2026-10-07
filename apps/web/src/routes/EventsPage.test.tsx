import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventsPage } from './EventsPage';

describe('EventsPage', () => {
  it('lists events with their date and court count', async () => {
    const events = [{ id: 'e1', name: '15/U Ladies', eventDate: '2026-09-12', courts: 5 }];
    render(<EventsPage client={{ listEvents: async () => events } as any} />);
    expect(await screen.findByText('15/U Ladies')).toBeTruthy();
    expect(screen.getByText(/5 courts/)).toBeTruthy();
  });
});
