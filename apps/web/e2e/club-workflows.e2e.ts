import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Fixtures = {
  mainEventId: string;
  checkInEventId: string;
  dayOfEventId: string;
  draftEventId: string;
  ticketToken: string;
  adminEmail: string;
};

const API_ORIGIN = 'http://localhost:3000';
const CONTROL_ORIGIN = 'http://localhost:3001';
let fixtures: Fixtures;

async function signIn(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: 'Staff sign-in' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel('Email').fill(fixtures.adminEmail);
  await page.getByRole('button', { name: /send link/i }).click();
  await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
  const outbox = await request.get(`${CONTROL_ORIGIN}/__test/outbox?to=${encodeURIComponent(fixtures.adminEmail)}`).then((response) => response.json());
  const email = outbox.messages.find((message: { subject: string }) => message.subject.includes('Sign in'));
  const link = email?.text.match(/https?:\/\/[^\s]+/)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page.getByRole('link', { name: /go to events/i })).toBeVisible();
  await page.getByRole('link', { name: /go to events/i }).click();
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Staff sign-in' }).click();
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
}

async function openEventTool(page: Page, name: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Event workflows' });
  await expect(nav).toBeVisible();
  const toggle = nav.getByRole('button', { name: /^Event tools/ });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await nav.getByRole('link', { name, exact: true }).click();
}

// With the fake provider the public form opens the test payment simulation; the
// registration response carries the fake Checkout session id used as its token.
async function submitPublicRegistration(page: Page): Promise<string> {
  const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && /\/api\/public\/events\/[^/]+\/registrations$/.test(new URL(candidate.url()).pathname));
  await page.getByRole('button', { name: 'Submit registration' }).click();
  const body = await (await response).json() as { simulationToken?: string };
  expect(body.simulationToken).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Test payment simulation' })).toBeVisible();
  return body.simulationToken!;
}

// Roster-change tools on the Full Game List start collapsed so assignments lead.
async function openRosterChanges(page: Page): Promise<void> {
  const disclosure = page.locator('details.game-roster-changes');
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await disclosure.getByText('Roster changes').click();
  }
}

function workspace(page: Page) {
  return page.locator('main > section');
}

async function adminGet(page: Page, request: APIRequestContext, url: string) {
  const session = (await page.context().cookies(API_ORIGIN)).find((cookie) => cookie.name === 'nt_session');
  expect(session, 'verified browser session cookie').toBeTruthy();
  return request.get(url, { headers: { cookie: `nt_session=${session!.value}` } });
}

async function adminPost(page: Page, request: APIRequestContext, url: string, data: unknown) {
  const session = (await page.context().cookies(API_ORIGIN)).find((cookie) => cookie.name === 'nt_session');
  expect(session, 'verified browser session cookie').toBeTruthy();
  return request.post(url, { headers: { cookie: `nt_session=${session!.value}` }, data });
}

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    nodes: violation.nodes.map((node) => node.target),
  }))).toEqual([]);
}

test.beforeEach(async ({ request }) => {
  const ready = await request.get(`${CONTROL_ORIGIN}/__test/ready`);
  expect(ready.ok()).toBeTruthy();
  expect(await ready.json()).toEqual({ status: 'ready' });
  const response = await request.post(`${CONTROL_ORIGIN}/__test/reset`);
  expect(response.ok()).toBeTruthy();
  fixtures = await response.json();
});

test('public navigation exposes all sign-in flows and serves the home logo locally', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url());
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) externalRequests.push(requestEvent.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Upcoming trials' })).toBeVisible();
  const logo = page.getByRole('link', { name: 'Trials home' });
  await expect(logo).toHaveAttribute('href', '/');
  await expect.poll(() => logo.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const signIn = page.getByRole('navigation', { name: 'Staff and volunteer access' });
  await expect(signIn.getByRole('link', { name: 'Staff sign-in' })).toHaveAttribute('href', '/admin');
  await signIn.getByRole('link', { name: 'Staff sign-in' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(signIn.getByRole('link', { name: 'Volunteer check-in' })).toHaveAttribute('href', '/check-in');
  await signIn.getByRole('link', { name: 'Volunteer check-in' }).click();
  await expect(page).toHaveURL(/\/check-in$/);
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  await expect(page.getByLabel('Trial', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Event PIN')).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('Vite hot-reloads edits to the mounted web stylesheet', async ({ page }) => {
  const stylesheet = fileURLToPath(new URL('../src/styles.css', import.meta.url));
  const original = await readFile(stylesheet, 'utf8');
  const marker = `hmr-${Date.now()}`;
  await page.goto('/check-in');
  await expect(page.locator('.app-main')).toBeVisible();
  try {
    await writeFile(stylesheet, `${original}\n.app-main { --rancher-hmr-probe: ${marker}; }\n`);
    await expect.poll(() => page.request.get(`/src/styles.css?probe=${marker}`).then((response) => response.text()), { timeout: 12_000 }).toContain(marker);
    await expect.poll(
      () => page.locator('.app-main').evaluate((element) => getComputedStyle(element).getPropertyValue('--rancher-hmr-probe').trim()),
      { timeout: 12_000 },
    ).toBe(marker);
  } finally {
    await page.close();
    await writeFile(stylesheet, original);
  }
});

test('parent registration stays neutral, checkout return stays pending, and ticket has QR/calendar only', async ({ page, request }) => {
  const authCalls: string[] = [];
  const nonLocalRequests: string[] = [];
  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url());
    if (url.pathname === '/api/auth/me') authCalls.push(requestEvent.url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !(['localhost', '127.0.0.1'].includes(url.hostname) && ['5173', '3000'].includes(url.port))) nonLocalRequests.push(requestEvent.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/register/${fixtures.mainEventId}`);
  await expect(page.getByRole('heading', { name: 'E2E 15/U Ladies' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('option', { name: 'MENA' })).toBeAttached();
  await expectAccessible(page);
  await page.getByLabel('Player first name').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Player last name')).toBeFocused();

  await page.getByRole('button', { name: 'Submit registration' }).click();
  const summary = page.locator('[aria-labelledby="registration-errors-title"]');
  await expect(summary).toBeFocused();
  await expect(page.locator('#dateOfBirth')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#dateOfBirth')).toHaveAttribute('aria-describedby', 'dateOfBirth-error');

  await page.getByLabel('Player first name').fill('Browser');
  await page.getByLabel('Player last name').fill('Parent');
  await page.getByLabel('Player date of birth').fill('2012-05-04');
  await page.getByLabel('Parent or guardian name').fill('Taylor Parent');
  await page.getByLabel('Parent or guardian email').fill('browser-parent@example.test');
  await page.getByLabel('Parent or guardian mobile').fill('0400000000');
  await page.getByLabel('Member association').selectOption({ label: 'MENA' });
  await page.getByLabel('First position').selectOption('WA');
  await page.getByLabel(/I confirm the player meets these eligibility requirements/).check();
  const sessionId = await submitPublicRegistration(page);
  await expect(page.getByText(/no real payment will be taken/i)).toBeVisible();
  await expect(page.getByText(/duplicate/i)).toHaveCount(0);
  await page.goto(`/register/${fixtures.mainEventId}/pending?session=${encodeURIComponent(sessionId!)}`);
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await expect(page.getByText(/Payment received/i)).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Chisholm Netball logo' })).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(1);

  // This pre-seeded ticket fixture exercises the ticket page only; the fake Checkout remains pending.
  await page.goto(`/ticket/${fixtures.ticketToken}`);
  await expect(page.getByRole('heading', { name: 'Ada Ticket' })).toBeVisible();
  await expect(page.getByRole('img', { name: /check-in qr code for ada ticket/i })).toBeVisible();
  await expect(page.getByText(/parent1@example\.test/i)).toHaveCount(0);
  await expectAccessible(page);
  const [calendar] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /download calendar invite/i }).click(),
  ]);
  expect(calendar.suggestedFilename()).toMatch(/^trials-.+\.ics$/);
  expect(authCalls).toEqual([]);
  expect(nonLocalRequests).toEqual([]);
});

test('admin logs in, controls events, exports roster, reviews and messages', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const unauthorized = await request.get(`${API_ORIGIN}/api/admin/events/${fixtures.mainEventId}/roster`);
  const unauthorizedExport = await request.get(`${API_ORIGIN}/api/admin/events/${fixtures.mainEventId}/roster/export`);
  expect(unauthorized.status()).toBe(401);
  expect(unauthorizedExport.status()).toBe(401);
  await signIn(page, request);
  await expect(page.getByRole('link', { name: 'Trials home' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('navigation', { name: 'Staff and volunteer access' })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('link', { name: 'E2E Draft event' }).click();
  await openEventTool(page, 'Event operations');
  await expect(page.getByText('Status: draft')).toBeVisible();
  await expectAccessible(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /open registration/i }).click();
  await expect(page.getByText('Status: open')).toBeVisible();
  await page.getByLabel('Set or rotate check-in PIN').fill('482193');
  await page.getByRole('button', { name: /set or rotate pin/i }).click();
  await expect(page.getByText('PIN: Configured')).toBeVisible();
  await page.getByRole('button', { name: /close check-in/i }).click();
  await expect(page.getByText('Status: Closed')).toBeVisible();
  await page.getByRole('button', { name: /close event/i }).click();
  await expect(page.getByText('Status: closed', { exact: true })).toBeVisible();
  await page.locator('nav[aria-label="Administration"]').getByRole('link', { name: 'Member associations' }).click();
  await expect(page.getByRole('heading', { name: 'Member associations' })).toBeVisible();
  await page.getByLabel('New association name').fill('Test Region Club');
  await page.getByRole('button', { name: 'Add association' }).click();
  await expect(page.getByText('Test Region Club', { exact: true })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'E2E 15/U Ladies' }).click();
  await openEventTool(page, 'Roster and export');
  await expect(page.getByRole('heading', { name: 'Event roster' })).toBeVisible();
  await expect(page.getByText(/Player1 Trial/)).toBeVisible();
  await expectAccessible(page);
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download roster CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe(`roster-${fixtures.mainEventId}.csv`);

  await openEventTool(page, 'Review queue');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await expect(page.getByLabel('Note')).toHaveCount(2);
  await expectAccessible(page);
  await page.getByLabel('Note').first().fill('Checked against association records');
  await page.getByRole('button', { name: 'Mark reviewed' }).first().click();
  await expect(page.getByLabel('Note')).toHaveCount(1);
  await page.getByRole('button', { name: /withdraw/i }).click();
  await expect(page.getByText('Nothing to review.')).toBeVisible();

  await openEventTool(page, 'Messages');
  await page.getByLabel('Subject').fill('Trial day update');
  await page.getByLabel('Message').fill('Please arrive at the usual time.');
  await page.getByRole('button', { name: 'Review recipients' }).click();
  await expect(page.getByText(/26 distinct paid parent email addresses/i)).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Send to 26 recipients' }).click();
  await expect(page.getByRole('status')).toHaveText('26 sent, 0 failed');
  expect(pageErrors).toEqual([]);
});

test('Admin opens event-scoped check-in without a PIN', async ({ page, request }) => {
  await signIn(page, request);
  await page.getByRole('link', { name: 'E2E Check-in' }).click();
  await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible();
  await openEventTool(page, 'Event operations');
  await page.getByRole('link', { name: 'Admin check-in' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Check-in' })).toBeVisible();
  await expect(page.getByLabel('Event PIN')).toHaveCount(0);
  await page.getByRole('link', { name: 'Look up by name instead' }).click();
  await page.getByLabel('Player name').fill('Checkin1 Trial');
  await page.getByRole('button', { name: 'Check in' }).first().click();
  await expect(page.getByRole('status')).toHaveText(/Checkin1 Trial, Number 1 — Refer to committee/);
});

test('Admin assists a family on a closed event day and sends hosted Checkout without marking paid', async ({ page, request }) => {
  const externalRequests: string[] = [];
  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url());
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) externalRequests.push(requestEvent.url());
  });
  await signIn(page, request);
  await page.getByRole('link', { name: 'E2E Day-of registration' }).click();
  await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible();
  await openEventTool(page, 'Event operations');
  await page.getByRole('link', { name: 'Add day-of player' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Day-of registration' })).toBeVisible();
  await page.getByLabel('Player first name').fill('Day-of');
  await page.getByLabel('Player last name').fill('Player');
  await page.getByLabel('Player date of birth').fill('2012-05-04');
  await page.getByLabel('Parent or guardian name').fill('Casey Parent');
  await page.getByLabel('Parent or guardian email').fill('dayofparent@example.test');
  await page.getByLabel('Parent or guardian mobile').fill('0400000000');
  await page.getByLabel('Member association').selectOption({ label: 'MENA' });
  await page.getByLabel('First position').selectOption('C');
  await page.getByLabel(/I confirm the player meets these eligibility requirements/).check();
  await page.getByRole('button', { name: 'Send payment link' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout link sent' })).toBeVisible();
  await expect(page.getByText(/remains pending.*not eligible for check-in or game planning until payment is confirmed/i)).toBeVisible();
  await expectAccessible(page);

  const outbox = await request.get(`${CONTROL_ORIGIN}/__test/outbox?to=dayofparent%40example.test`).then((response) => response.json());
  const checkoutEmail = outbox.messages.find((message: { subject: string }) => message.subject === 'Continue your Netball Trials registration');
  expect(checkoutEmail?.text).toMatch(/https:\/\/checkout\.test\/fake_[\w-]+/);
  const rosterResponse = await adminGet(page, request, `${API_ORIGIN}/api/admin/events/${fixtures.dayOfEventId}/roster`);
  expect(rosterResponse.status()).toBe(200);
  const roster = await rosterResponse.json();
  expect(roster.registrations).toContainEqual(expect.objectContaining({ playerName: 'Day-of Player', status: 'PENDING', checkedInAt: null }));

  await page.goto(`/admin/events/${fixtures.dayOfEventId}/check-in`);
  await expect(page.getByRole('heading', { name: 'E2E Day-of registration' })).toBeVisible();
  await expect(page.getByText('0 of 0 arrived')).toBeVisible();
  await page.getByRole('link', { name: 'Look up by name instead' }).click();
  const lookupResponse = page.waitForResponse((response) => response.url().includes('/api/check-in/lookup?'));
  await page.getByLabel('Player name').fill('Day-of Player');
  expect(await (await lookupResponse).json()).toEqual([]);
  await expectAccessible(page);
  expect(externalRequests).toEqual([]);
});

test('volunteer uses manual fallback, sees referral/name/number, live count and undo without parent contacts', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/check-in?eventId=${encodeURIComponent(fixtures.checkInEventId)}`);
  await expect(page.getByLabel('Event ID')).toHaveValue(fixtures.checkInEventId);
  await page.getByLabel('Event PIN').fill('482193');
  await page.getByRole('button', { name: 'Start check-in' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Check-in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trials home' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('navigation', { name: 'Staff and volunteer access' })).toHaveCount(0);
  await expect(page.getByText('0 of 14 arrived')).toBeVisible();
  await page.getByRole('link', { name: 'Look up by name instead' }).click();
  await page.getByLabel('Player name').fill('Checkin1 Trial');
  await page.getByRole('button', { name: 'Check in' }).first().click();
  await expect(page.getByRole('status')).toHaveText(/Checkin1 Trial, Number 1 — Refer to committee/);
  await expect(page.getByText('1 of 14 arrived')).toBeVisible();
  await expect(page.getByText(/checkin1@example\.test/)).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Undo last check-in' }).click();
  await expect(page.getByText('0 of 14 arrived')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('Full Game List supports the 390px viewport and accessible round editing', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, request);
  await page.getByRole('link', { name: 'E2E 15/U Ladies' }).click();
  await openEventTool(page, 'Plan rounds');
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await expect(page.getByRole('button', { name: 'Publish revision' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish revision' }).click();
  await expect(workspace(page).getByRole('link', { name: 'Print selector sheets' })).toBeVisible();
  await page.getByRole('link', { name: 'Adjust event settings' }).click();
  await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible();
  await openEventTool(page, 'Full Game List');
  await expect(page.getByRole('heading', { name: 'Full Game List' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  const reviewDirectory = fileURLToPath(new URL('../../../.impeccable/review/full-game-list/', import.meta.url));
  await mkdir(reviewDirectory, { recursive: true });
  const reviewPage = await page.context().newPage();
  await reviewPage.setViewportSize({ width: 390, height: 844 });
  await reviewPage.goto(`/admin/events/${fixtures.mainEventId}/games`);
  await expect(reviewPage.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await reviewPage.evaluate(() => window.scrollTo(0, 0));
  expect(await reviewPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await reviewPage.screenshot({ path: `${reviewDirectory}/mobile-viewport.png` });
  await reviewPage.screenshot({ path: `${reviewDirectory}/mobile.png`, fullPage: true });
  await expectAccessible(reviewPage);
  await reviewPage.getByRole('button', { name: 'Edit round 1' }).click();
  await expect(reviewPage.getByLabel('Player to move')).toBeVisible();
  await expect(reviewPage.getByLabel('Destination slot')).toBeVisible();
  expect(await reviewPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await reviewPage.screenshot({ path: `${reviewDirectory}/editor-mobile.png`, fullPage: true });
  await expectAccessible(reviewPage);
  await reviewPage.close();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: `${reviewDirectory}/desktop.png`, fullPage: true });
  await expectAccessible(page);

  const publishedBefore = await adminGet(page, request, `${API_ORIGIN}/api/admin/events/${fixtures.mainEventId}/plan?published=true`).then((response) => response.json());
  await page.setViewportSize({ width: 390, height: 844 });
  await openRosterChanges(page);
  await page.getByRole('button', { name: 'Remove early leaver' }).click();
  await page.getByLabel('Remove Player1 Trial from round 1 onward').check();
  await page.getByRole('button', { name: 'Rebuild fixtures from round' }).click();
  await expect(page.getByRole('alert')).toContainText(/cannot fill 2 courts.*need 28/i);
  const publishedAfter = await adminGet(page, request, `${API_ORIGIN}/api/admin/events/${fixtures.mainEventId}/plan?published=true`).then((response) => response.json());
  const latest = await adminGet(page, request, `${API_ORIGIN}/api/admin/events/${fixtures.mainEventId}/plan`).then((response) => response.json());
  expect(publishedAfter.id).toBe(publishedBefore.id);
  expect(latest.id).toBe(publishedBefore.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectAccessible(page);
});

test('Admin manages a live plan safely after a late arrival and early leaver', async ({ page, request }) => {
  const externalRequests: string[] = [];
  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) externalRequests.push(requestEvent.url());
  });
  await signIn(page, request);
  await page.getByRole('link', { name: 'E2E 15/U Ladies' }).click();
  await openEventTool(page, 'Plan rounds');
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await page.getByRole('button', { name: 'Publish revision' }).click();

  const eventUrl = `${API_ORIGIN}/api/admin/events/${fixtures.mainEventId}`;
  const planUrl = `${eventUrl}/plan`;
  const publishedResponse = await adminGet(page, request, `${planUrl}?published=true`);
  expect(publishedResponse.status()).toBe(200);
  const originalPlan = await publishedResponse.json();
  const playerOneId = originalPlan.players.find((player: { playerName: string }) => player.playerName === 'Player1 Trial')?.registrationId;
  expect(playerOneId).toBeTruthy();
  const firstSlot = originalPlan.slots.find((slot: { round: number; registrationId: string }) => slot.round === 1 && slot.registrationId === playerOneId);
  const targetSlot = originalPlan.slots.find((slot: { round: number; registrationId: string }) => slot.round === 1 && slot.registrationId !== playerOneId);
  expect(firstSlot).toBeTruthy();
  expect(targetSlot).toBeTruthy();
  const keyFor = (slot: { round: number; court: number; position: string; team: number }) => `${slot.round}:${slot.court}:${slot.position}:${slot.team}`;
  const planRoundInput = (plan: { slots: Array<{ round: number; court: number; position: string; team: number; registrationId: string }> }, round: number) =>
    plan.slots.filter((slot) => slot.round === round).map(({ round: slotRound, court, position, team, registrationId }) => ({ round: slotRound, court, position, team, registrationId }));
  const performMove = async (round: number, registrationId: string, slot: { round: number; court: number; position: string; team: number }) => {
    await page.getByRole('button', { name: `Edit round ${round}` }).click();
    await page.getByLabel('Player to move').selectOption(registrationId);
    await page.getByLabel('Destination slot').selectOption(keyFor(slot));
    await page.getByRole('button', { name: 'Move or substitute' }).click();
  };

  await page.goto(`/admin/events/${fixtures.mainEventId}/games`);
  await expect(page.getByRole('heading', { name: 'Full Game List' })).toBeVisible();
  await expectAccessible(page);
  for (const color of ['White', 'Black', 'Grey', 'Orange']) await expect(page.getByText(color).first()).toBeVisible();

  await performMove(1, playerOneId, targetSlot);
  await page.getByRole('button', { name: 'Cancel changes' }).click();
  const afterCancel = await adminGet(page, request, `${planUrl}?published=true`).then((response) => response.json());
  expect(afterCancel.id).toBe(originalPlan.id);

  await performMove(1, playerOneId, targetSlot);
  await page.getByRole('button', { name: 'Save round 1' }).click();
  const saveAnyway = page.getByRole('button', { name: 'Save anyway' });
  await expect.poll(async () => (await saveAnyway.isVisible()) || (await page.getByText('Revision 2 is now active.').isVisible())).toBe(true);
  if (await saveAnyway.isVisible()) await saveAnyway.click();
  await expect(page.getByText('Revision 2 is now active.')).toBeVisible();
  const afterSwap = await adminGet(page, request, `${planUrl}?published=true`).then((response) => response.json());
  expect(afterSwap.id).not.toBe(originalPlan.id);
  expect(afterSwap.slots.find((slot: { round: number; court: number; position: string; team: number }) => keyFor(slot) === keyFor(firstSlot)).registrationId).toBe(targetSlot.registrationId);
  expect(afterSwap.slots.find((slot: { round: number; court: number; position: string; team: number }) => keyFor(slot) === keyFor(targetSlot)).registrationId).toBe(playerOneId);

  const oldRevision = await adminGet(page, request, `${planUrl}/revisions/${originalPlan.id}`);
  expect(oldRevision.status()).toBe(200);
  expect((await oldRevision.json()).slots).toEqual(originalPlan.slots);
  const invalidSlots = planRoundInput(afterSwap, 1);
  invalidSlots[1]!.registrationId = invalidSlots[0]!.registrationId;
  const invalid = await adminPost(page, request, `${planUrl}/rounds/1/manual`, {
    sourcePlanId: afterSwap.id, slots: invalidSlots, overrideWarnings: true,
  });
  expect(invalid.status()).toBe(422);
  const stale = await adminPost(page, request, `${planUrl}/rounds/1/manual`, {
    sourcePlanId: originalPlan.id, slots: planRoundInput(originalPlan, 1), overrideWarnings: true,
  });
  expect(stale.status()).toBe(409);
  expect((await adminGet(page, request, `${planUrl}?published=true`).then((response) => response.json())).id).toBe(afterSwap.id);

  await page.getByRole('button', { name: 'Revision history' }).click();
  await page.getByRole('button', { name: 'View revision 1' }).click();
  await expect(page.getByText('Viewing revision 1 — read-only')).toBeVisible();
  await page.getByRole('button', { name: 'Return to active revision' }).click();
  await expect(page.getByText('Active revision 2')).toBeVisible();

  const parentEmail = 'late-parent@example.test';
  await page.goto(`/register/${fixtures.mainEventId}`);
  await page.getByLabel('Player first name').fill('Late Arrival');
  await page.getByLabel('Player last name').fill('Trial');
  await page.getByLabel('Player date of birth').fill('2012-05-04');
  await page.getByLabel('Parent or guardian name').fill('Late Parent');
  await page.getByLabel('Parent or guardian email').fill(parentEmail);
  await page.getByLabel('Parent or guardian mobile').fill('0400000001');
  await page.getByLabel('Member association').selectOption({ label: 'MENA' });
  await page.getByLabel('First position').selectOption('GS');
  await page.getByLabel(/I confirm the player meets these eligibility requirements/).check();
  const sessionId = await submitPublicRegistration(page);
  const pendingRoster = await adminGet(page, request, `${eventUrl}/roster`).then((response) => response.json());
  const lateRegistration = pendingRoster.registrations.find((registration: { playerName: string }) => registration.playerName === 'Late Arrival Trial');
  expect(lateRegistration).toMatchObject({ status: 'PENDING', bibNumber: null, checkedInAt: null });
  const pendingGameRoster = await adminGet(page, request, `${eventUrl}/game-roster`).then((response) => response.json());
  expect(pendingGameRoster.some((player: { registrationId: string }) => player.registrationId === lateRegistration.id)).toBe(false);
  await page.goto(`/admin/events/${fixtures.mainEventId}/games`);
  await expect(page.getByText('Late Arrival Trial')).toHaveCount(0);

  const payment = await request.post(`${API_ORIGIN}/api/webhooks/stripe`, {
    headers: { 'stripe-signature': 'ok' },
    data: {
      kind: 'checkout_completed', stripeEventId: 'e2e-late-arrival-payment', registrationId: lateRegistration.id,
      sessionId, amountCents: 3500, currency: 'aud', paymentStatus: 'paid', paymentIntentId: 'pi_e2e_late_arrival',
    },
  });
  expect(payment.status()).toBe(200);
  expect((await payment.json()).status).toBe('ok');
  const paidRoster = await adminGet(page, request, `${eventUrl}/roster`).then((response) => response.json());
  expect(paidRoster.registrations.find((registration: { id: string }) => registration.id === lateRegistration.id)).toMatchObject({ status: 'PAID', bibNumber: null, checkedInAt: null });
  const paidGameRoster = await adminGet(page, request, `${eventUrl}/game-roster`).then((response) => response.json());
  expect(paidGameRoster.some((player: { registrationId: string }) => player.registrationId === lateRegistration.id)).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Full Game List' })).toBeVisible();
  await expect(page.getByText('Late Arrival Trial')).toHaveCount(0);

  await page.goto(`/admin/events/${fixtures.mainEventId}/operations`);
  await page.getByRole('link', { name: 'Admin check-in' }).click();
  await page.getByRole('link', { name: 'Look up by name instead' }).click();
  await page.getByLabel('Player name').fill('Late Arrival Trial');
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText(/Late Arrival Trial, Number 29/)).toBeVisible();
  const checkedInRoster = await adminGet(page, request, `${eventUrl}/roster`).then((response) => response.json());
  expect(checkedInRoster.registrations.find((registration: { id: string }) => registration.id === lateRegistration.id)).toMatchObject({ status: 'PAID', bibNumber: 29 });
  const checkedInGameRoster = await adminGet(page, request, `${eventUrl}/game-roster`).then((response) => response.json());
  expect(checkedInGameRoster).toContainEqual(expect.objectContaining({ registrationId: lateRegistration.id, playerName: 'Late Arrival Trial', bibNumber: 29 }));

  await page.goto(`/admin/events/${fixtures.mainEventId}/games`);
  await expect(page.getByText('Late Arrival Trial')).toBeVisible();
  const beforeSubstitution = await adminGet(page, request, `${planUrl}?published=true`).then((response) => response.json());
  const lateTarget = beforeSubstitution.slots.find((slot: { round: number; position: string; registrationId: string }) => slot.round === 2 && slot.position !== 'GS' && slot.registrationId !== playerOneId);
  expect(lateTarget).toBeTruthy();
  await performMove(2, lateRegistration.id, lateTarget);
  await page.getByRole('button', { name: 'Save round 2' }).click();
  await expect(page.getByRole('alert')).toContainText('Late Arrival Trial is not opted in to');
  await page.getByRole('button', { name: 'Save anyway' }).click();
  await expect(page.getByText('Revision 3 is now active.')).toBeVisible();
  const beforeRebuild = await adminGet(page, request, `${planUrl}?published=true`).then((response) => response.json());
  const playerOneBefore = (await adminGet(page, request, `${eventUrl}/roster`).then((response) => response.json())).registrations.find((registration: { id: string }) => registration.id === playerOneId);

  await openRosterChanges(page);
  await page.getByRole('button', { name: 'Remove early leaver' }).click();
  await page.getByLabel('Remove future assignments from round').selectOption('2');
  await page.getByLabel('Remove Player1 Trial from round 2 onward').check();
  await page.getByRole('button', { name: 'Rebuild fixtures from round' }).click();
  await expect(page.getByText('Draft revision 4 is ready for review.')).toBeVisible();
  const activeDuringDraft = await adminGet(page, request, `${planUrl}?published=true`).then((response) => response.json());
  const draft = await adminGet(page, request, planUrl).then((response) => response.json());
  expect(activeDuringDraft.id).toBe(beforeRebuild.id);
  expect(draft.status).toBe('DRAFT');
  const roundOneSignature = (plan: { slots: Array<{ round: number; court: number; position: string; team: number; registrationId: string }> }) =>
    plan.slots.filter((slot) => slot.round === 1).map((slot) => `${slot.court}:${slot.position}:${slot.team}:${slot.registrationId}`).sort();
  expect(roundOneSignature(draft)).toEqual(roundOneSignature(beforeRebuild));
  expect(draft.slots.some((slot: { round: number; registrationId: string }) => slot.round === 2 && slot.registrationId === playerOneId)).toBe(false);
  await page.getByRole('link', { name: 'Review draft in Plan Rounds' }).click();
  await page.getByRole('button', { name: 'Publish revision' }).click();
  await expect(page.locator('p').filter({ hasText: /^Published revision 4/ })).toBeVisible();

  const finalPlan = await adminGet(page, request, `${planUrl}?published=true`).then((response) => response.json());
  expect(finalPlan.id).toBe(draft.id);
  expect(finalPlan.players.find((player: { registrationId: string }) => player.registrationId === playerOneId)?.active).toBe(false);
  expect(finalPlan.slots.some((slot: { round: number; registrationId: string }) => slot.round === 1 && slot.registrationId === playerOneId)).toBe(true);
  expect(finalPlan.slots.some((slot: { round: number; registrationId: string }) => slot.round >= 2 && slot.registrationId === playerOneId)).toBe(false);
  const playerOneAfter = (await adminGet(page, request, `${eventUrl}/roster`).then((response) => response.json())).registrations.find((registration: { id: string }) => registration.id === playerOneId);
  expect(playerOneAfter).toMatchObject({ status: 'PAID', bibNumber: 1, checkedInAt: playerOneBefore.checkedInAt });
  expect((await adminGet(page, request, `${planUrl}/revisions/${originalPlan.id}`).then((response) => response.json())).slots).toEqual(originalPlan.slots);
  expect((await adminGet(page, request, `${planUrl}/revisions/${beforeRebuild.id}`).then((response) => response.json())).slots).toEqual(beforeRebuild.slots);

  await page.goto(`/admin/events/${fixtures.mainEventId}/games`);
  const reportRoster = JSON.stringify(await adminGet(page, request, `${eventUrl}/game-roster`).then((response) => response.json()));
  expect(reportRoster).not.toMatch(/parentEmail|parentName|amountCents|paymentIntentId|checkoutSessionId/i);
  expect(JSON.stringify(finalPlan)).not.toMatch(/parentEmail|parentName|parentMobile|amountCents|paymentIntentId|checkoutSessionId/i);
  await page.getByLabel('Game view').selectOption('statistics');
  const statistics = page.getByRole('table', { name: 'Player Statistics' });
  await expect(statistics).toBeVisible();
  const earlyStats = statistics.getByRole('row', { name: /Player1 Trial/ });
  const lateStats = statistics.getByRole('row', { name: /Late Arrival Trial/ });
  expect((await earlyStats.getByRole('cell').allTextContents()).slice(0, 2)).toEqual(['1', '1']);
  const lateGameCount = finalPlan.slots.filter((slot: { registrationId: string }) => slot.registrationId === lateRegistration.id).length;
  expect(lateGameCount).toBeGreaterThan(0);
  expect((await lateStats.getByRole('cell').allTextContents()).slice(0, 2)).toEqual(['29', String(lateGameCount)]);
  expect(await statistics.innerText()).not.toMatch(/late-parent@example\.test|parent\d+@example\.test|amount|payment/i);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expectAccessible(page);
  }

  await page.getByLabel('Game view').selectOption('reference');
  const reference = page.getByRole('table', { name: 'Player Reference' });
  await expect(reference).toBeVisible();
  const earlyReference = await reference.getByRole('row', { name: /Player1 Trial/ }).getByRole('cell').allTextContents();
  const lateReference = await reference.getByRole('row', { name: /Late Arrival Trial/ }).getByRole('cell').allTextContents();
  expect(earlyReference[0]).toBe('1');
  expect(earlyReference.slice(2)).toEqual(Array.from({ length: finalPlan.rounds - 1 }, () => 'Not playing'));
  expect(lateReference[0]).toBe('29');
  expect(lateReference[1]).toBe('Not playing');
  expect(lateReference.slice(2).every((cell: string) => /Court \d, .* — (White|Black|Grey|Orange)/.test(cell))).toBe(true);
  for (const color of ['White', 'Black', 'Grey', 'Orange']) await expect(reference).toContainText(color);
  expect(await reference.innerText()).not.toMatch(/late-parent@example\.test|parent\d+@example\.test|amount|payment/i);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expectAccessible(page);
  }
  expect(externalRequests).toEqual([]);
});

test('planner previews, publishes, regenerates without changing the prefix, and prints four landscape sheets', async ({ page, request }) => {
  await signIn(page, request);
  await page.getByRole('link', { name: 'E2E 15/U Ladies' }).click();
  await openEventTool(page, 'Plan rounds');
  await expect(page.getByText(/28 checked-in players/i)).toBeVisible();
  await expect(page.getByText(/minimum round lower bound: 2/i)).toBeVisible();
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await expect(page.locator('table caption', { hasText: 'schedule preview' })).toBeVisible();
  await expect(page.locator('table.schedule-preview tbody tr')).toHaveCount(56);
  await expect(workspace(page).getByRole('link', { name: 'Print selector sheets' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish revision' }).click();
  await expect(workspace(page).getByRole('link', { name: 'Print selector sheets' })).toBeVisible();

  const publishedBeforeResponse = await adminGet(page, request, `${API_ORIGIN}/api/admin/events/${fixtures.mainEventId}/plan?published=true`);
  expect(publishedBeforeResponse.status()).toBe(200);
  const publishedBefore = await publishedBeforeResponse.json();
  await page.getByLabel('Regenerate from round').fill('2');
  await page.getByRole('button', { name: 'Regenerate suffix' }).click();
  await expect(page.getByText(/Draft revision 2/)).toBeVisible();
  const draftResponse = await adminGet(page, request, `${API_ORIGIN}/api/admin/events/${fixtures.mainEventId}/plan`);
  expect(draftResponse.status()).toBe(200);
  const draft = await draftResponse.json();
  const prefix = (plan: { slots: Array<{ round: number; court: number; position: string; team: number; registrationId: string }> }) =>
    plan.slots.filter((slot) => slot.round === 1).map(({ round, court, position, team, registrationId }) => ({ round, court, position, team, registrationId })).sort((a, b) => `${a.court}:${a.position}:${a.team}`.localeCompare(`${b.court}:${b.position}:${b.team}`));
  expect(prefix(draft)).toEqual(prefix(publishedBefore));
  await page.getByRole('button', { name: 'Publish revision' }).click();
  await expect(page.getByText(/Published revision 2/)).toBeVisible();
  await workspace(page).getByRole('link', { name: 'Print selector sheets' }).click();
  await expect(page.locator('.sheet-preview .sheet')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Print selector sheets' })).toBeVisible();
  const selectorText = await page.locator('.sheet-preview').innerText();
  for (const value of ['Team A', 'Team B', 'White', 'Black', 'Grey', 'Orange', 'Number', 'Choices', 'Rating', 'Notes/Feedback']) expect(selectorText).toContain(value);
  const playerChoice = page.locator('.sheet-preview .sheet').locator('tr').filter({ hasText: 'Player1 Trial' }).first().locator('td').nth(2);
  await expect(playerChoice).toHaveText('GS');
  expect(selectorText).not.toMatch(/parent\d+@example\.test|amountCents|paymentIntentId/);
  await expectAccessible(page);

  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('.app-header').evaluate((element) => getComputedStyle(element).visibility)).toBe('hidden');
  expect(await page.locator('.sheets-page > header').evaluate((element) => getComputedStyle(element).display)).toBe('none');
  const selectorPdf = await page.pdf({ path: '/tmp/netball-e2e-selector-sheets.pdf', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  const selectorPdfText = Buffer.from(selectorPdf).toString('latin1');
  expect(selectorPdfText.match(/\/Type\s*\/Page\b/g) ?? []).toHaveLength(4);
  const selectorMediaBox = selectorPdfText.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
  expect(selectorMediaBox).not.toBeNull();
  expect(Number(selectorMediaBox?.[1])).toBeCloseTo(842, 0);
  expect(Number(selectorMediaBox?.[2])).toBeCloseTo(595, 0);

  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('link', { name: 'Download Blank Sheet' }).click();
  await expect(page.getByRole('heading', { name: 'Blank game sheet' })).toBeVisible();
  await expect(page.locator('.sheet-preview .sheet')).toHaveCount(1);
  const blankText = await page.locator('.sheet-preview').innerText();
  for (const value of ['E2E 15/U Ladies', '2027-09-12', 'Round:', 'Court:', 'Team A color:', 'Team B color:', 'GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK', 'Number', 'Player', 'Rating', 'Notes/Feedback']) expect(blankText).toContain(value);
  expect(blankText).not.toMatch(/parent\d+@example\.test|amountCents|paymentIntentId/);
  expect(await page.locator('.sheet-preview .sheet').count()).toBe(1);
  await expect(page.getByRole('link', { name: 'Back to selector sheets' })).toHaveAttribute('href', `/admin/events/${fixtures.mainEventId}/sheets`);
  await expect(page.getByRole('button', { name: 'Print blank game sheet' })).toBeVisible();
  await expectAccessible(page);

  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('.app-header').evaluate((element) => getComputedStyle(element).visibility)).toBe('hidden');
  expect(await page.locator('.sheets-page > header').evaluate((element) => getComputedStyle(element).display)).toBe('none');
  const blankPdf = await page.pdf({ path: '/tmp/netball-e2e-blank-game-sheet.pdf', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  const blankPdfText = Buffer.from(blankPdf).toString('latin1');
  expect(blankPdfText.match(/\/Type\s*\/Page\b/g) ?? []).toHaveLength(1);
  const blankMediaBox = blankPdfText.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
  expect(blankMediaBox).not.toBeNull();
  expect(Number(blankMediaBox?.[1])).toBeCloseTo(842, 0);
  expect(Number(blankMediaBox?.[2])).toBeCloseTo(595, 0);
});
