import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RegisterPage } from './RegisterPage';

afterEach(cleanup);

function publicEvent() {
  return {
    id: 'e1', name: '15/U Ladies', competitionYear: 2027, eventDate: '2026-09-12T00:00:00.000Z',
    venue: 'SNC', startTime: '08:30', firstWhistle: '09:00', registrationFeeCents: 3500, currency: 'aud',
    policyUrl: 'https://chisholmnetball.com/selection-policy/', minAge: 12, maxAge: 15,
    division: '15/U', section: 'Ladies', courts: 5, status: 'OPEN',
  };
}

const associations = [
  { id: 'mena', name: 'MENA', active: true },
  { id: 'inactive', name: 'Old Club', active: false },
];

function client(register: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
  return {
    getPublicEvent: vi.fn().mockResolvedValue(publicEvent()),
    listPublicAssociations: vi.fn().mockResolvedValue(associations),
    register,
    ...extra,
  } as any;
}

function adminEvent() {
  return { ...publicEvent(), status: 'CLOSED', endTime: '12:00', lastWhistle: '11:30', rank1Min: 2, rank2Min: 1, rank3Min: 1 };
}

async function fillRegistrationForm() {
  fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText(/player last name/i), { target: { value: 'Lovelace' } });
  fireEvent.change(screen.getByLabelText(/player date of birth/i), { target: { value: '2012-04-02' } });
  fireEvent.change(await screen.findByLabelText(/first position/i), { target: { value: 'GA' } });
  fireEvent.change(screen.getByLabelText(/parent or guardian name/i), { target: { value: 'Anne' } });
  fireEvent.change(screen.getByLabelText(/parent or guardian email/i), { target: { value: 'anne@example.com' } });
  fireEvent.change(screen.getByLabelText(/parent or guardian mobile/i), { target: { value: '0400000000' } });
  await screen.findByRole('option', { name: 'MENA' });
  fireEvent.change(screen.getByLabelText(/member association/i), { target: { value: 'MENA' } });
  fireEvent.click(screen.getByLabelText(/I confirm the player meets these eligibility requirements/));
}

describe('RegisterPage', () => {
  it('shows neutral next steps after a registration request', async () => {
    const register = vi.fn().mockResolvedValue({ status: 'received' });
    const api = client(register);
    render(<RegisterPage client={api} eventId="e1" />);
    fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Ada' } });
    fireEvent.change(await screen.findByLabelText(/first position/i), { target: { value: 'GA' } });
    await screen.findByRole('option', { name: 'MENA' });
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    expect(await screen.findByRole('heading', { name: /request received/i })).toBeInTheDocument();
    expect(screen.getByText(/check the parent or guardian email/i)).toBeInTheDocument();
    expect(screen.queryByText(/duplicate/i)).not.toBeInTheDocument();
    expect(api.getPublicEvent).toHaveBeenCalledWith('e1');
    expect(register).toHaveBeenCalledWith('e1', expect.objectContaining({ eligibilityConfirmed: false }));
  });

  it('requires an explicit first-position choice and explains the available positions', async () => {
    const register = vi.fn().mockResolvedValue({ status: 'received' });
    render(<RegisterPage client={client(register)} eventId="e1" />);

    const firstPosition = await screen.findByLabelText(/first position/i);
    expect(firstPosition).toHaveValue('');
    expect(firstPosition).toBeRequired();
    expect(screen.getByRole('option', { name: 'Choose a first position' })).toHaveValue('');
    expect(within(firstPosition).getByRole('option', { name: 'Goal shooter (GS)' })).toHaveValue('GS');
    await screen.findByRole('option', { name: 'MENA' });
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('First position');
    expect(screen.getByText('Choose a first position for the player.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('groups registration details and keeps eligibility criteria beside confirmation', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);

    expect(await screen.findByRole('group', { name: 'Player details' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Parent or guardian details' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Position preferences' })).toBeInTheDocument();
    const eligibility = screen.getByRole('group', { name: 'Eligibility confirmation' });
    expect(within(eligibility).getByText(/six association games between 1 January 2027 and the day before the trial/i)).toBeInTheDocument();
    expect(within(eligibility).getByLabelText(/I confirm the player meets these eligibility requirements/i)).toBeInTheDocument();
  });

  it('shows the event date in the same Australian long-date format as the home listing', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);

    expect(await screen.findByText(/12 September 2026 at SNC/)).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-12 at SNC/)).not.toBeInTheDocument();
  });

  it('uses the Admin event and day-of endpoint, and explains payment is still pending', async () => {
    const register = vi.fn();
    const dayOfRegistration = vi.fn().mockResolvedValue({ status: 'received' });
    const getPublicEvent = vi.fn();
    const getEvent = vi.fn().mockResolvedValue(adminEvent());
    const api = client(register, { getPublicEvent, getEvent, dayOfRegistration });
    render(<RegisterPage client={api} eventId="e1" adminAssisted />);

    expect(await screen.findByRole('heading', { name: '15/U Ladies' })).toBeInTheDocument();
    await fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));

    expect(await screen.findByRole('heading', { name: 'Checkout link sent' })).toBeInTheDocument();
    expect(screen.getByText(/not eligible for check-in or game planning until payment is confirmed/i)).toBeInTheDocument();
    expect(getEvent).toHaveBeenCalledWith('e1');
    expect(getPublicEvent).not.toHaveBeenCalled();
    expect(dayOfRegistration).toHaveBeenCalledWith('e1', expect.objectContaining({
      playerFirstName: 'Ada', parentEmail: 'anne@example.com', eligibilityConfirmed: true,
    }));
    expect(register).not.toHaveBeenCalled();
  });

  it('retains Admin form details after Checkout fails so the family can retry', async () => {
    const dayOfRegistration = vi.fn().mockRejectedValueOnce({ status: 503, message: 'checkout_unavailable' })
      .mockResolvedValueOnce({ status: 'received' });
    const api = client(vi.fn(), { getEvent: vi.fn().mockResolvedValue(adminEvent()), dayOfRegistration });
    render(<RegisterPage client={api} eventId="e1" adminAssisted />);
    await fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not prepare or send the secure checkout link/i);
    expect(screen.getByLabelText(/player first name/i)).toHaveValue('Ada');
    expect(screen.getByLabelText(/parent or guardian email/i)).toHaveValue('anne@example.com');
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    expect(await screen.findByRole('heading', { name: 'Checkout link sent' })).toBeInTheDocument();
    expect(dayOfRegistration).toHaveBeenCalledTimes(2);
  });

  it('shows a non-sensitive duplicate message for an already registered player', async () => {
    const dayOfRegistration = vi.fn().mockRejectedValue({ status: 409, message: 'already_registered' });
    const api = client(vi.fn(), { getEvent: vi.fn().mockResolvedValue(adminEvent()), dayOfRegistration });
    render(<RegisterPage client={api} eventId="e1" adminAssisted />);
    await fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/this player is already registered/i);
    expect(alert.textContent).not.toMatch(/anne@example.com|Ada Lovelace/);
  });

  it('loads only active associations and displays eligibility, privacy and policy information', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);
    const association = await screen.findByLabelText(/member association/i);
    expect(association.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'MENA' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Old Club' })).not.toBeInTheDocument();
    expect(screen.getByText(/the full eligibility criteria appear beside the confirmation at the end of this form/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View eligibility criteria' })).toHaveAttribute('href', '#eligibility-confirmation-summary');
    expect(screen.getAllByText(/permanent player in a domestic or representative competition/i)).toHaveLength(1);
    expect(screen.getByRole('link', { name: /selection policy/i })).toHaveAttribute('href', publicEvent().policyUrl);
    expect(screen.getByText(/12 calendar months after the event date/i)).toBeInTheDocument();
  });

  it('associates server field errors with controls and focuses the error summary', async () => {
    const register = vi.fn().mockRejectedValue({ status: 400, fields: ['dateOfBirth', 'rank2Position', 'memberAssociation'] });
    render(<RegisterPage client={client(register)} eventId="e1" />);
    fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/player date of birth/i), { target: { value: '2011-04-02' } });
    fireEvent.change(screen.getByLabelText(/first position/i), { target: { value: 'GS' } });
    fireEvent.change(screen.getByLabelText(/second position/i), { target: { value: 'WA' } });
    fireEvent.change(screen.getByLabelText(/member association/i), { target: { value: 'MENA' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /continue to payment/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(document.activeElement).toBe(summary));
    for (const field of ['dateOfBirth', 'rank2Position', 'memberAssociation']) {
      const control = document.getElementById(field)!;
      expect(control).toHaveAttribute('aria-invalid', 'true');
      expect(control).toHaveAttribute('aria-describedby', `${field}-error`);
    }
    expect(screen.getByLabelText(/player first name/i)).toHaveValue('Ada');
    expect(screen.getByLabelText(/member association/i)).toHaveValue('MENA');
  });

  it('preserves entered values after a transient provider failure and allows retry', async () => {
    const register = vi.fn().mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce({ status: 'received' });
    render(<RegisterPage client={client(register)} eventId="e1" />);
    const firstName = await screen.findByLabelText(/player first name/i);
    fireEvent.change(firstName, { target: { value: 'Ada' } });
    fireEvent.change(await screen.findByLabelText(/first position/i), { target: { value: 'GS' } });
    fireEvent.change(screen.getByLabelText(/parent or guardian email/i), { target: { value: 'anne@example.com' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /continue to payment/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start registration/i);
    expect(screen.getByLabelText(/player first name/i)).toHaveValue('Ada');
    expect(screen.getByLabelText(/parent or guardian email/i)).toHaveValue('anne@example.com');
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    expect(await screen.findByRole('heading', { name: /request received/i })).toBeInTheDocument();
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('shows a card-free test simulation and links to the pending ticket after success', async () => {
    const simulationToken = 'fake_session_opaque';
    const register = vi.fn().mockResolvedValue({ status: 'received', simulationToken });
    const completeFakePayment = vi.fn().mockResolvedValue({ status: 'paid' });
    render(<RegisterPage client={client(register, { completeFakePayment })} eventId="e1" />);
    await fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));

    expect(await screen.findByRole('heading', { name: 'Test payment simulation' })).toBeInTheDocument();
    expect(screen.getByText(/no real payment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number|card expiry|security code|cvc/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }));

    expect(await screen.findByRole('link', { name: 'View test ticket' })).toHaveAttribute(
      'href',
      `/register/e1/pending?session=${encodeURIComponent(simulationToken)}`,
    );
    expect(completeFakePayment).toHaveBeenCalledWith(simulationToken);
  });

  it('shows generic recovery copy when fake payment cannot be completed', async () => {
    const register = vi.fn().mockResolvedValue({ status: 'received', simulationToken: 'fake_unbound' });
    const completeFakePayment = vi.fn().mockResolvedValue({ status: 'not_completed' });
    render(<RegisterPage client={client(register, { completeFakePayment })} eventId="e1" />);
    await fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate successful payment' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not complete this test payment/i);
    expect(alert).not.toHaveTextContent(/duplicate|already registered|parent email/i);
    expect(screen.queryByRole('link', { name: 'View test ticket' })).not.toBeInTheDocument();
  });
});
