import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('shows the neutral confirmation after requesting a link', async () => {
    const requestLink = vi.fn().mockResolvedValue({ status: 'sent' });
    render(<LoginPage client={{ requestLink } as any} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send link/i }));
    expect(await screen.findByText(/check your email/i)).toBeTruthy();
    expect(requestLink).toHaveBeenCalledWith('a@example.com');
  });
});
