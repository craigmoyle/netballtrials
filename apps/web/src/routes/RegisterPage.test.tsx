import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegisterPage } from './RegisterPage';

describe('RegisterPage', () => {
  it('shows neutral next steps after a registration request', async () => {
    const register = vi.fn().mockResolvedValue({ status: 'received' });
    render(
      <RegisterPage
        client={{ getPublicEvent: async () => publicEvent(), register } as any}
        eventId="e1"
      />,
    );
    fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: /register and pay/i }));
    expect(await screen.findByRole('heading', { name: /request received/i })).toBeTruthy();
    expect(screen.getByText(/check the parent or guardian email/i)).toBeTruthy();
  });
});

function publicEvent() {
  return {
    id: 'e1', name: '15/U Ladies', eventDate: '2026-09-12', venue: 'SNC', firstWhistle: '09:00',
    registrationFeeCents: 3500, currency: 'aud', policyUrl: 'https://x', minAge: 12, maxAge: 15, division: '15/U', section: 'Ladies', courts: 5, status: 'OPEN',
  };
}
