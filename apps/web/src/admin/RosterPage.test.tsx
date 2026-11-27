import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RosterPage } from './RosterPage';
import { ApiError } from '../api/client';

const originalCreateObjectURL = URL.createObjectURL;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
  else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
});

const roster = {
  eventId: 'event-1',
  positionCounts: { rank1: { GS: 2 }, rank2: { WA: 1 }, rank3: { C: 1 }, extraOptIn: 1 },
  registrations: [{
    id: 'reg-1', playerName: 'Ada Lovelace', dateOfBirth: '2012-04-02', parentName: 'Anne',
    parentEmail: 'anne@example.com', parentMobile: '0400000000', memberAssociation: 'MENA',
    rank1Position: 'GS', rank2Position: 'WA', rank3Position: null, optInExtraPositions: true,
    ageFlagged: false, status: 'PAID', amountCents: 3500, currency: 'aud', bibNumber: 4,
    checkedInAt: '2026-09-12T00:00:00.000Z',
  }],
};

function renderPage(client: Record<string, unknown>) {
  return render(<MemoryRouter><RosterPage client={client as any} eventId="event-1" /></MemoryRouter>);
}

describe('RosterPage', () => {
  it('lets an Admin correct the date of birth and member association in place', async () => {
    const corrected = { ...roster.registrations[0], dateOfBirth: '2013-04-02', memberAssociation: 'Other Association', ageFlagged: true };
    const correctRegistration = vi.fn().mockResolvedValue(corrected);
    renderPage({
      getRoster: vi.fn().mockResolvedValue(roster), downloadRoster: vi.fn(),
      listAssociations: vi.fn().mockResolvedValue([
        { id: 'mena', name: 'MENA', active: true },
        { id: 'other', name: 'Other Association', active: true },
        { id: 'old', name: 'Old Association', active: false },
      ]),
      correctRegistration,
    });

    fireEvent.click(await screen.findByRole('button', { name: /correct details for ada lovelace/i }));
    expect(await screen.findByRole('heading', { name: /correct registration details/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Old Association' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Player date of birth'), { target: { value: '2013-04-02' } });
    fireEvent.change(screen.getByLabelText('Member association'), { target: { value: 'Other Association' } });
    fireEvent.change(screen.getByLabelText('Who confirmed the correction and how?'), { target: { value: 'Confirmed by guardian by phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => expect(correctRegistration).toHaveBeenCalledWith('event-1', 'reg-1', {
      dateOfBirth: '2013-04-02', memberAssociation: 'Other Association', reason: 'Confirmed by guardian by phone',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/registration details corrected/i);
    expect(screen.getByText(/2013-04-02/)).toBeInTheDocument();
    expect(screen.getByText('Other Association')).toBeInTheDocument();
    expect(screen.getByText(/review flagged/i)).toBeInTheDocument();
  });

  it('keeps the correction form open and explains duplicate, validation and missing errors', async () => {
    const correctRegistration = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, 'already_registered'))
      .mockRejectedValueOnce(new ApiError(400, 'validation_failed', ['dateOfBirth']))
      .mockRejectedValueOnce(new ApiError(404, 'not_found'));
    renderPage({
      getRoster: vi.fn().mockResolvedValue(roster), downloadRoster: vi.fn(),
      listAssociations: vi.fn().mockResolvedValue([{ id: 'mena', name: 'MENA', active: true }]),
      correctRegistration,
    });
    fireEvent.click(await screen.findByRole('button', { name: /correct details for ada lovelace/i }));
    fireEvent.change(await screen.findByLabelText('Player date of birth'), { target: { value: '2013-04-02' } });
    fireEvent.change(screen.getByLabelText('Who confirmed the correction and how?'), { target: { value: 'Confirmed by guardian by phone' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already an active registration/i);
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid date of birth/i);
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/i);
  });

  it('shows choice counts and minimal contact/payment/check-in data', async () => {
    renderPage({ getRoster: vi.fn().mockResolvedValue(roster), downloadRoster: vi.fn() });
    expect(await screen.findByRole('heading', { name: /roster/i })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Event roster' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Scroll horizontally to view all roster details.')).toBeInTheDocument();
    expect(screen.getByText('anne@example.com')).toBeInTheDocument();
    expect(screen.getByText(/\$35\.00/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Checked in')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View changes' })).toHaveAttribute('href', '/admin/events/event-1/roster/reg-1/changes');
    expect(screen.queryByText(/bib 4/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'First choice' })).toBeInTheDocument();
    expect(screen.getByText('GS: 2')).toBeInTheDocument();
  });

  it('shows a genuine empty state and retries a roster load error', async () => {
    const getRoster = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      ...roster, registrations: [],
    });
    renderPage({ getRoster, downloadRoster: vi.fn() });
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the roster/i);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(/no registrations for this event/i)).toBeInTheDocument();
    expect(getRoster).toHaveBeenCalledTimes(2);
  });

  it('requires removal reasons, makes Other notes explicit, and warns that removal does not refund payment', async () => {
    const removeRegistration = vi.fn().mockResolvedValue({
      id: 'reg-1', status: 'WITHDRAWN', planning: { draftPlanId: 'draft-1', gaps: [] },
    });
    renderPage({ getRoster: vi.fn().mockResolvedValue(roster), downloadRoster: vi.fn(), removeRegistration });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove player Ada Lovelace' }));

    expect(screen.getByText(/removing a paid player does not refund the payment/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Removal reason'), { target: { value: 'Other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/note is required/i);
    fireEvent.change(screen.getByLabelText('Reason note'), { target: { value: 'Confirmed by the family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));

    await waitFor(() => expect(removeRegistration).toHaveBeenCalledWith('event-1', 'reg-1', {
      reason: 'Other', note: 'Confirmed by the family',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/removed from future planning/i);
  });

  it('completes a paid late arrival and surfaces planner gaps without hiding the saved attendance', async () => {
    const lateRoster = { ...roster, registrations: [{ ...roster.registrations[0], checkedInAt: null, bibNumber: null }] };
    const completeLateArrival = vi.fn().mockResolvedValue({
      result: 'checked_in', bibNumber: 12,
      planning: { draftPlanId: null, gaps: [{ code: 'missing_court', message: 'Need one more GS player for court 2.' }] },
    });
    renderPage({ getRoster: vi.fn().mockResolvedValue(lateRoster), downloadRoster: vi.fn(), completeLateArrival });

    fireEvent.click(await screen.findByRole('button', { name: 'Complete late arrival for Ada Lovelace' }));

    await waitFor(() => expect(completeLateArrival).toHaveBeenCalledWith('event-1', 'reg-1'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/need one more GS player/i);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Checked in')).toBeInTheDocument();
  });

  it('marks a paid duplicate against the retained event registration', async () => {
    const duplicateRoster = { ...roster, registrations: [
      roster.registrations[0],
      { ...roster.registrations[0], id: 'reg-2', playerName: 'Ada Lovelace', parentEmail: 'other@example.com', bibNumber: 5 },
    ] };
    const markRegistrationDuplicate = vi.fn().mockResolvedValue({ id: 'reg-2', status: 'DUPLICATE', planning: { draftPlanId: null, gaps: [] } });
    renderPage({ getRoster: vi.fn().mockResolvedValue(duplicateRoster), downloadRoster: vi.fn(), markRegistrationDuplicate });

    fireEvent.click(await screen.findByRole('button', { name: 'Mark duplicate for Ada Lovelace (other@example.com)' }));
    fireEvent.change(screen.getByLabelText('Retained registration'), { target: { value: 'reg-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm duplicate' }));

    await waitFor(() => expect(markRegistrationDuplicate).toHaveBeenCalledWith('event-1', 'reg-2', {
      duplicateOfRegistrationId: 'reg-1', reason: 'Duplicate', note: '',
    }));
  });

  it('downloads a CSV with the event-scoped filename and reports retention expiry', async () => {
    const downloadRoster = vi.fn().mockResolvedValueOnce(new Blob(['csv']))
      .mockRejectedValueOnce(new ApiError(410, 'roster_retention_expired'));
    const createObjectURL = vi.fn().mockReturnValue('blob:roster');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const clickedNames: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedNames.push(this.download);
    });
    renderPage({ getRoster: vi.fn().mockResolvedValue(roster), downloadRoster });
    fireEvent.click(await screen.findByRole('button', { name: /download roster csv/i }));
    await waitFor(() => expect(clickedNames).toEqual(['roster-event-1.csv']));
    fireEvent.click(screen.getByRole('button', { name: /download roster csv/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/export period has ended/i);
  });
});
