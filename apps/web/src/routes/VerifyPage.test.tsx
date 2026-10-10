import { describe, it, expect, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { VerifyPage } from './VerifyPage';

function Host({ client }: { client: any }) {
  const [signedIn, setSignedIn] = useState(false);
  return (
    <MemoryRouter initialEntries={['/admin/verify?token=abc']}>
      <VerifyPage client={client} onSignedIn={() => setSignedIn(true)} />
      <p>signedIn: {String(signedIn)}</p>
    </MemoryRouter>
  );
}

describe('VerifyPage', () => {
  it('shows the verified state in React Strict Mode despite the development effect replay', async () => {
    const verify = vi.fn().mockResolvedValue({ status: 'signed_in' });
    render(<StrictMode><Host client={{ verify }} /></StrictMode>);
    expect(await screen.findByRole('link', { name: /go to events/i })).toBeTruthy();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('verifies the token once even when the parent re-renders', async () => {
    const verify = vi.fn().mockResolvedValue({ status: 'signed_in' });
    render(<Host client={{ verify }} />);
    expect(await screen.findByText(/signed in/i)).toBeTruthy();
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
