import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient as Client } from '../api/client';
import { RegistrationChangeHistoryPage } from './RegistrationChangeHistoryPage';

afterEach(cleanup);

describe('RegistrationChangeHistoryPage', () => {
  it('shows who changed each field and the recorded before-and-after values', async () => {
    const client = {
      getRegistrationChanges: vi.fn().mockResolvedValue([{
        id: 'change-1', actorType: 'PARENT', createdAt: '2026-10-28T10:00:00.000Z',
        changedFields: ['parentMobile'],
        changes: [{ field: 'parentMobile', before: '0400000000', after: '0411111111' }],
      }]),
    } as unknown as Client;
    render(<MemoryRouter><RegistrationChangeHistoryPage client={client} eventId="event-1" registrationId="registration-1" /></MemoryRouter>);

    const table = await screen.findByRole('table', { name: 'Recorded registration changes' });
    expect(table).toHaveTextContent('PARENT');
    expect(table).toHaveTextContent('parentMobile');
    expect(table).toHaveTextContent('0400000000');
    expect(table).toHaveTextContent('0411111111');
    expect(client.getRegistrationChanges).toHaveBeenCalledWith('event-1', 'registration-1');
  });
});
