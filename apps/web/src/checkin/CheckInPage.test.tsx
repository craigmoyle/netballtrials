import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CheckInPage } from './CheckInPage';

describe('CheckInPage', () => {
  it('shows the pin form', () => {
    render(<MemoryRouter><CheckInPage client={{} as any} /></MemoryRouter>);
    expect(screen.getByLabelText(/event pin/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /start check-in/i })).toBeTruthy();
  });
});
