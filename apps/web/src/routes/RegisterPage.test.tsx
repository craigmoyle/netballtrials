import { isValidElement, type ComponentProps, type ReactElement } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render as renderWithTestingLibrary, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { RegisterPage } from './RegisterPage';

const testRouters: ReturnType<typeof createMemoryRouter>[] = [];

afterEach(() => {
  cleanup();
  for (const router of testRouters) router.dispose();
  testRouters.length = 0;
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(element: ReactElement) {
  if (!isValidElement(element) || element.type !== RegisterPage) return renderWithTestingLibrary(element);
  const props = element.props as ComponentProps<typeof RegisterPage>;
  const router = createMemoryRouter([
    {
      path: '/register/:eventId',
      element: <><Link to="/leave-registration">Leave registration</Link><RegisterPage {...props} /></>,
    },
    { path: '/leave-registration', element: <h1>Left registration</h1> },
  ], { initialEntries: [`/register/${props.eventId}`] });
  testRouters.push(router);
  return renderWithTestingLibrary(<RouterProvider router={router} />);
}

function publicEvent() {
  return {
    id: 'e1', name: '15/U Ladies', competitionYear: 2027, eventDate: '2026-09-12T00:00:00.000Z',
    venue: 'SNC', startTime: '08:30', firstWhistle: '09:00', registrationFeeCents: 3500, currency: 'aud',
    policyUrl: 'https://chisholmnetball.com/selection-policy/', minAge: 12, maxAge: 15,
    division: '15/U', section: 'Ladies', courts: 5, status: 'OPEN',
  };
}

const publicDraftKey = 'chisholm-registration-draft:public:v1:e1';

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
    await fillRegistrationForm();
    expect(screen.getByRole('button', { name: 'Submit registration' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    const receiptHeading = await screen.findByRole('heading', { name: /request received/i });
    expect(screen.getByText(/check the parent or guardian email for the secure checkout link/i)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(receiptHeading));
    const emailHandoffUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(emailHandoffUnload);
    expect(emailHandoffUnload.defaultPrevented).toBe(false);
    expect(screen.queryByText(/duplicate/i)).not.toBeInTheDocument();
    expect(api.getPublicEvent).toHaveBeenCalledWith('e1');
    expect(register).toHaveBeenCalledWith('e1', expect.objectContaining({ eligibilityConfirmed: true }));
    expect(window.sessionStorage.getItem(publicDraftKey)).toBeNull();
  });

  it('marks all server-required controls and leaves optional choices optional', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);
    await screen.findByRole('group', { name: 'Eligibility confirmation' });

    const requiredFields = [
      ['playerFirstName', 'Player first name'],
      ['playerLastName', 'Player last name'],
      ['dateOfBirth', 'Player date of birth'],
      ['parentName', 'Parent or guardian name'],
      ['parentEmail', 'Parent or guardian email'],
      ['parentMobile', 'Parent or guardian mobile'],
      ['memberAssociation', 'Member association'],
      ['rank1Position', 'First position'],
      ['eligibilityConfirmed', 'I confirm the player meets these eligibility requirements'],
    ];
    for (const [id, label] of requiredFields) {
      const control = document.getElementById(id)! as HTMLInputElement | HTMLSelectElement;
      expect(control).toBeRequired();
      expect(control.labels?.[0]?.textContent).toMatch(/\(required\)/i);
      expect(screen.getByLabelText(new RegExp(label))).toBe(control);
    }
    expect(screen.getByLabelText(/second position/i)).not.toBeRequired();
    expect(screen.getByLabelText(/third position/i)).not.toBeRequired();
    expect(screen.getByLabelText(/open to extra games/i)).not.toBeRequired();
  });

  it('saves a public draft in this tab and restores it after reload', async () => {
    const api = client(vi.fn());
    const currentPage = render(<RegisterPage client={api} eventId="e1" />);
    expect(await screen.findByText(/reload this tab within 1 hour to restore your draft/i)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Ada' } });

    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(publicDraftKey) ?? 'null')).toMatchObject({
      version: 1,
      form: { playerFirstName: 'Ada' },
    }));
    expect(window.localStorage.length).toBe(0);
    currentPage.unmount();

    render(<RegisterPage client={api} eventId="e1" />);
    expect(await screen.findByLabelText(/player first name/i)).toHaveValue('Ada');
    expect(await screen.findByRole('status')).toHaveTextContent(/draft restored from this tab/i);
  });

  it('clears a saved draft and its fields when the parent requests it', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);
    fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Ada' } });
    await waitFor(() => expect(window.sessionStorage.getItem(publicDraftKey)).not.toBeNull());
    fireEvent.click(screen.getByText('Privacy details'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved draft and form' }));

    expect(confirm).toHaveBeenCalledWith('Clear the saved draft and all entered details from this tab?');
    expect(screen.getByLabelText(/player first name/i)).toHaveValue('');
    expect(window.sessionStorage.getItem(publicDraftKey)).toBeNull();
  });

  it('warns when this tab cannot clear its draft after registration', async () => {
    const register = vi.fn().mockResolvedValue({ status: 'received' });
    render(<RegisterPage client={client(register)} eventId="e1" />);
    await fillRegistrationForm();
    await waitFor(() => expect(window.sessionStorage.getItem(publicDraftKey)).not.toBeNull());
    const storedSession = window.sessionStorage;
    vi.stubGlobal('sessionStorage', {
      getItem: storedSession.getItem.bind(storedSession),
      setItem: storedSession.setItem.bind(storedSession),
      removeItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      clear: storedSession.clear.bind(storedSession),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    expect(await screen.findByRole('heading', { name: 'Request received' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not confirm the draft was cleared/i);
  });

  it('keeps the form usable when this browser blocks session storage', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new DOMException('blocked', 'SecurityError'); }),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);
    const firstName = await screen.findByLabelText(/player first name/i);
    fireEvent.change(firstName, { target: { value: 'Ada' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save or clear a draft/i);
    expect(firstName).toHaveValue('Ada');
  });

  it('discards an expired public draft instead of restoring it', async () => {
    window.sessionStorage.setItem(publicDraftKey, JSON.stringify({
      version: 1,
      savedAt: Date.now() - 60 * 60 * 1000 - 1,
      form: {
        playerFirstName: 'Ada', playerLastName: '', dateOfBirth: '', parentName: '', parentEmail: '',
        parentMobile: '', memberAssociation: '', rank1Position: '', rank2Position: '', rank3Position: '',
        optInExtraPositions: false, eligibilityConfirmed: false,
      },
    }));
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);

    expect(await screen.findByLabelText(/player first name/i)).toHaveValue('');
    expect(window.sessionStorage.getItem(publicDraftKey)).toBeNull();
  });

  it('reports all missing public registration fields before requesting registration', async () => {
    const register = vi.fn();
    render(<RegisterPage client={client(register)} eventId="e1" />);
    const submit = await screen.findByRole('button', { name: 'Submit registration' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    const summary = await screen.findByRole('alert');
    for (const label of [
      'Player first name', 'Player last name', 'Player date of birth', 'Parent or guardian name',
      'Parent or guardian email', 'Parent or guardian mobile', 'Member association', 'First position', 'Eligibility confirmation',
    ]) {
      expect(within(summary).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(register).not.toHaveBeenCalled();
  });

  it('does not cache Admin-assisted registration details in the browser', async () => {
    const api = client(vi.fn(), { getEvent: vi.fn().mockResolvedValue(adminEvent()) });
    render(<RegisterPage client={api} eventId="e1" adminAssisted />);
    fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Ada' } });

    expect(window.sessionStorage.length).toBe(0);
  });

  it('reports all missing Admin-assisted fields before sending a payment link', async () => {
    const dayOfRegistration = vi.fn();
    const api = client(vi.fn(), { getEvent: vi.fn().mockResolvedValue(adminEvent()), dayOfRegistration });
    render(<RegisterPage client={api} eventId="e1" adminAssisted />);
    const sendPaymentLink = await screen.findByRole('button', { name: 'Send payment link' });
    await waitFor(() => expect(sendPaymentLink).toBeEnabled());
    fireEvent.click(sendPaymentLink);

    const summary = await screen.findByRole('alert');
    for (const label of [
      'Player first name', 'Player last name', 'Player date of birth', 'Parent or guardian name',
      'Parent or guardian email', 'Parent or guardian mobile', 'Member association', 'First position', 'Eligibility confirmation',
    ]) {
      expect(within(summary).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(dayOfRegistration).not.toHaveBeenCalled();
  });

  it('presents eligibility criteria as three scannable items', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);
    const eligibility = await screen.findByRole('group', { name: 'Eligibility confirmation' });
    const criteria = within(eligibility).getByRole('list');

    expect(within(criteria).getAllByRole('listitem')).toHaveLength(3);
    expect(within(criteria).getByText(/12–15 years old as at 31 December 2027/i)).toBeInTheDocument();
    expect(within(criteria).getByText(/permanent player in a domestic or representative competition/i)).toBeInTheDocument();
    expect(within(criteria).getByText(/six association games between 1 January 2027/i)).toBeInTheDocument();
  });

  it('omits the selection-policy link when the event has no policy URL', async () => {
    const api = client(vi.fn(), { getPublicEvent: vi.fn().mockResolvedValue({ ...publicEvent(), policyUrl: null }) });
    render(<RegisterPage client={api} eventId="e1" />);

    await screen.findByRole('heading', { name: '15/U Ladies' });
    expect(screen.queryByRole('link', { name: /selection policy/i })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('First position');
    expect(screen.getByText('Choose a first position for the player.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('prevents the same position from being selected in multiple ranks', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);
    const first = await screen.findByLabelText(/first position/i);
    const second = screen.getByLabelText(/second position/i);
    const third = screen.getByLabelText(/third position/i);
    fireEvent.change(second, { target: { value: 'GA' } });
    fireEvent.change(third, { target: { value: 'WA' } });

    expect(within(first).getByRole('option', { name: 'Goal attack (GA)' })).toBeDisabled();
    expect(within(first).getByRole('option', { name: 'Wing attack (WA)' })).toBeDisabled();
    expect(within(second).getByRole('option', { name: 'Wing attack (WA)' })).toBeDisabled();
    expect(within(second).getByRole('option', { name: 'Goal attack (GA)' })).not.toBeDisabled();
    expect(first).toHaveValue('');
    expect(second).toHaveValue('GA');
    expect(third).toHaveValue('WA');
    expect(screen.getByText(/clear a lower-ranked choice before moving it higher/i)).toBeInTheDocument();
  });

  it('shows eligibility at a glance before data entry and links to the full criteria', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);

    const summary = await screen.findByRole('region', { name: 'Eligibility at a glance' });
    expect(within(summary).getByText(/Age: 12–15 on 31 December 2027/i)).toBeInTheDocument();
    expect(within(summary).getByText(/Permanent player in a domestic or representative competition at a Chisholm Region member association/i)).toBeInTheDocument();
    expect(within(summary).getByText(/at least six association games from 1 January 2027 to the day before the trial/i)).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'View full criteria' })).toHaveAttribute('href', '/register/e1#eligibility-confirmation-summary');

    const firstField = await screen.findByLabelText(/player first name/i);
    expect(summary.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const eligibility = screen.getByRole('group', { name: 'Eligibility confirmation' });
    expect(within(eligibility).getAllByRole('listitem')).toHaveLength(3);
  });

  it('groups registration details and keeps eligibility criteria beside confirmation', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);

    expect(await screen.findByRole('group', { name: 'Player details' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Parent or guardian details' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Position preferences' })).toBeInTheDocument();
    const eligibility = screen.getByRole('group', { name: 'Eligibility confirmation' });
    expect(screen.getByRole('region', { name: 'Eligibility at a glance' })).toBeInTheDocument();
    expect(within(eligibility).getByText(/12–15 years old as at 31 December 2027/i)).toBeInTheDocument();
    expect(within(eligibility).getByText(/six association games between 1 January 2027 and the day before the trial/i)).toBeInTheDocument();
    expect(within(eligibility).getByLabelText(/I confirm the player meets these eligibility requirements/i)).toBeInTheDocument();
  });

  it('offers section links to the four registration groups', async () => {
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);

    const sectionsNav = await screen.findByRole('navigation', { name: 'Registration sections' });
    expect(within(sectionsNav).getByText('Parent / guardian')).toBeInTheDocument();
    const sections = [
      ['Player', 'Player details', '#player-details'],
      ['Parent / guardian', 'Parent or guardian details', '#parent-details'],
      ['Positions', 'Position preferences', '#position-preferences'],
      ['Eligibility', 'Eligibility confirmation', '#eligibility-confirmation'],
    ];
    for (const [linkLabel, sectionLabel, href] of sections) {
      expect(within(sectionsNav).getByRole('link', { name: linkLabel })).toHaveAttribute('href', `/register/e1${href}`);
      expect(screen.getByRole('group', { name: sectionLabel })).toHaveAttribute('id', href.slice(1));
    }
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
    expect(screen.getByRole('button', { name: 'Send payment link' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send payment link' }));

    const checkoutHeading = await screen.findByRole('heading', { name: 'Checkout link sent' });
    expect(screen.getByText(/not eligible for check-in or game planning until payment is confirmed/i)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(checkoutHeading));
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
    fireEvent.click(screen.getByRole('button', { name: 'Send payment link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not prepare or send the secure checkout link/i);
    expect(screen.getByLabelText(/player first name/i)).toHaveValue('Ada');
    expect(screen.getByLabelText(/parent or guardian email/i)).toHaveValue('anne@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send payment link' }));
    expect(await screen.findByRole('heading', { name: 'Checkout link sent' })).toBeInTheDocument();
    expect(dayOfRegistration).toHaveBeenCalledTimes(2);
  });

  it('shows a non-sensitive duplicate message for an already registered player', async () => {
    const dayOfRegistration = vi.fn().mockRejectedValue({ status: 409, message: 'already_registered' });
    const api = client(vi.fn(), { getEvent: vi.fn().mockResolvedValue(adminEvent()), dayOfRegistration });
    render(<RegisterPage client={api} eventId="e1" adminAssisted />);
    await fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: 'Send payment link' }));

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
    expect(screen.getByRole('region', { name: 'Eligibility at a glance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View full criteria' })).toHaveAttribute('href', '/register/e1#eligibility-confirmation-summary');
    expect(screen.getAllByText(/permanent player in a domestic or representative competition/i)).toHaveLength(2);
    const policyLink = screen.getByRole('link', { name: 'Selection policy (new tab)' });
    expect(policyLink).toHaveAttribute('href', publicEvent().policyUrl);
    expect(policyLink).toHaveAttribute('target', '_blank');
    expect(policyLink).toHaveAttribute('rel', 'noreferrer');
    const privacyDetails = screen.getByText('Privacy details');
    expect(privacyDetails.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(privacyDetails);
    expect(screen.getByText(/parent contact details are not shown to volunteers/i)).toBeInTheDocument();
    expect(screen.getByText(/12 calendar months after the event date/i)).toBeInTheDocument();
  });

  it('associates server field errors with controls and focuses the error summary', async () => {
    const register = vi.fn().mockRejectedValue({ status: 400, fields: ['dateOfBirth', 'rank2Position', 'memberAssociation'] });
    render(<RegisterPage client={client(register)} eventId="e1" />);
    await fillRegistrationForm();
    fireEvent.change(screen.getByLabelText(/player date of birth/i), { target: { value: '2011-04-02' } });
    fireEvent.change(screen.getByLabelText(/second position/i), { target: { value: 'WA' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit registration' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

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

  it('keeps section hash navigation inside the page and does not trigger the leave blocker', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);
    fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Ada' } });
    const router = testRouters.at(-1)!;

    fireEvent.click(screen.getByRole('link', { name: 'Eligibility' }));

    await waitFor(() => expect(router.state.location.hash).toBe('#eligibility-confirmation'));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Eligibility' })).toHaveAttribute('aria-current', 'location');
    fireEvent.click(screen.getByRole('link', { name: 'View full criteria' }));
    await waitFor(() => expect(router.state.location.hash).toBe('#eligibility-confirmation-summary'));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Eligibility' })).toHaveAttribute('aria-current', 'location');
  });

  it('marks the section currently intersecting the viewport in the anchor navigation', async () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    const observed: Element[] = [];
    class TestIntersectionObserver {
      root = null;
      rootMargin = '0px';
      thresholds = [0];
      constructor(callback: IntersectionObserverCallback) { observerCallback = callback; }
      observe(target: Element) { observed.push(target); }
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);

    await screen.findByRole('group', { name: 'Eligibility confirmation' });
    expect(observed.map((element) => element.id)).toEqual([
      'player-details', 'parent-details', 'position-preferences', 'eligibility-confirmation',
    ]);
    const position = document.getElementById('position-preferences')!;
    const bounds = position.getBoundingClientRect();
    act(() => observerCallback?.([{
      target: position, isIntersecting: true, intersectionRatio: 1,
      boundingClientRect: bounds, intersectionRect: bounds, rootBounds: null, time: 1,
    }], {} as IntersectionObserver));
    expect(screen.getByRole('link', { name: 'Positions' })).toHaveAttribute('aria-current', 'location');
  });

  it('stores public drafts only in this tab and warns that closing it clears the draft', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const localSetItem = vi.spyOn(window.localStorage, 'setItem');
    render(<RegisterPage client={client(vi.fn())} eventId="e1" />);

    const emptyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(emptyUnload);
    expect(emptyUnload.defaultPrevented).toBe(false);
    const firstName = await screen.findByLabelText(/player first name/i);
    fireEvent.change(firstName, { target: { value: 'Ada' } });
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    await waitFor(() => expect(window.sessionStorage.getItem(publicDraftKey)).not.toBeNull());
    expect(localSetItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: 'Leave registration' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/draft is saved in this tab/i)));
    expect(screen.getByLabelText(/player first name/i)).toHaveValue('Ada');
    fireEvent.click(screen.getByRole('link', { name: 'Leave registration' }));
    expect(await screen.findByRole('heading', { name: 'Left registration' })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('preserves entered values after a transient provider failure and allows retry', async () => {
    const register = vi.fn().mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce({ status: 'received' });
    render(<RegisterPage client={client(register)} eventId="e1" />);
    await fillRegistrationForm();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit registration' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start registration/i);
    expect(screen.getByLabelText(/player first name/i)).toHaveValue('Ada');
    expect(screen.getByLabelText(/parent or guardian email/i)).toHaveValue('anne@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    expect(await screen.findByRole('heading', { name: /request received/i })).toBeInTheDocument();
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('shows a card-free test simulation and links to the pending ticket after success', async () => {
    const simulationToken = 'fake_session_opaque';
    const register = vi.fn().mockResolvedValue({ status: 'received', simulationToken });
    const completeFakePayment = vi.fn().mockResolvedValue({ status: 'paid' });
    render(<RegisterPage client={client(register, { completeFakePayment })} eventId="e1" />);
    await fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    const simulationHeading = await screen.findByRole('heading', { name: 'Test payment simulation' });
    expect(await screen.findByRole('heading', { name: 'Test payment simulation' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(simulationHeading));
    const pendingUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pendingUnload);
    expect(pendingUnload.defaultPrevented).toBe(true);
    expect(screen.getByText(/no real payment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number|card expiry|security code|cvc/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }));

    expect(await screen.findByRole('link', { name: 'View test ticket' })).toHaveAttribute(
      'href',
      `/register/e1/pending?session=${encodeURIComponent(simulationToken)}`,
    );
    expect(completeFakePayment).toHaveBeenCalledWith(simulationToken);
    const completedUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(completedUnload);
    expect(completedUnload.defaultPrevented).toBe(false);
  });

  it('shows generic recovery copy when fake payment cannot be completed', async () => {
    const register = vi.fn().mockResolvedValue({ status: 'received', simulationToken: 'fake_unbound' });
    const completeFakePayment = vi.fn().mockResolvedValue({ status: 'not_completed' });
    render(<RegisterPage client={client(register, { completeFakePayment })} eventId="e1" />);
    await fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate successful payment' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not complete this test payment/i);
    expect(alert).not.toHaveTextContent(/duplicate|already registered|parent email/i);
    expect(screen.queryByRole('link', { name: 'View test ticket' })).not.toBeInTheDocument();
  });
});
