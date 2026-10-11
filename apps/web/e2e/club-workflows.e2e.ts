import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Fixtures = {
  mainEventId: string;
  checkInEventId: string;
  draftEventId: string;
  ticketToken: string;
  adminEmail: string;
};

const API_ORIGIN = 'http://localhost:3000';
const CONTROL_ORIGIN = 'http://localhost:3001';
let fixtures: Fixtures;

async function signIn(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto('/admin/login');
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
}

async function adminGet(page: Page, request: APIRequestContext, url: string) {
  const session = (await page.context().cookies(API_ORIGIN)).find((cookie) => cookie.name === 'nt_session');
  expect(session, 'verified browser session cookie').toBeTruthy();
  return request.get(url, { headers: { cookie: `nt_session=${session!.value}` } });
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
  const signIn = page.getByRole('navigation', { name: 'Sign in options' });
  await expect(signIn.getByRole('link', { name: 'Chisholm Admin' })).toHaveAttribute('href', '/admin/login');
  await expect(signIn.getByRole('link', { name: 'Committee member' })).toHaveAttribute('href', '/check-in');
  await expect(signIn.getByRole('link', { name: 'Volunteer' })).toHaveAttribute('href', '/check-in');
  await signIn.getByRole('link', { name: 'Committee member' }).click();
  await expect(page).toHaveURL(/\/check-in$/);
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  await expect(page.getByLabel('Event ID')).toBeVisible();
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

  await page.getByRole('button', { name: 'Continue to payment' }).click();
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
  await page.getByLabel(/I confirm the player meets the eligibility requirements/).check();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
  await expect(page.getByText(/duplicate/i)).toHaveCount(0);

  const outbox = await request.get(`${CONTROL_ORIGIN}/__test/outbox?to=browser-parent%40example.test`).then((response) => response.json());
  const checkoutMail = outbox.messages.find((message: { subject: string }) => message.subject.includes('Continue your Netball Trials registration'));
  expect(checkoutMail).toBeTruthy();
  const sessionId = checkoutMail.text.match(/checkout\.test\/([^\s]+)/)?.[1];
  expect(sessionId).toBeTruthy();
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
  await expect(page.getByRole('navigation', { name: 'Sign in options' })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('link', { name: 'E2E Draft event' }).click();
  await expect(page.getByText('Status: draft')).toBeVisible();
  await expectAccessible(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /open registration/i }).click();
  await expect(page.getByText('Status: open')).toBeVisible();
  await page.getByLabel('Set or rotate check-in PIN').fill('4821');
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
  await page.getByRole('link', { name: 'Roster and export' }).click();
  await expect(page.getByRole('heading', { name: 'Event roster' })).toBeVisible();
  await expect(page.getByText(/Player1 Trial/)).toBeVisible();
  await expectAccessible(page);
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download roster CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe(`roster-${fixtures.mainEventId}.csv`);

  await page.getByRole('link', { name: 'Review queue' }).click();
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await expect(page.getByLabel('Note')).toHaveCount(2);
  await expectAccessible(page);
  await page.getByLabel('Note').first().fill('Checked against association records');
  await page.getByRole('button', { name: 'Mark reviewed' }).first().click();
  await expect(page.getByLabel('Note')).toHaveCount(1);
  await page.getByRole('button', { name: /withdraw/i }).click();
  await expect(page.getByText('Nothing to review.')).toBeVisible();

  await page.getByRole('link', { name: 'Messages' }).click();
  await page.getByLabel('Subject').fill('Trial day update');
  await page.getByLabel('Message').fill('Please arrive at the usual time.');
  await page.getByRole('button', { name: 'Review recipients' }).click();
  await expect(page.getByText(/26 distinct paid parent email addresses/i)).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Send to 26 recipients' }).click();
  await expect(page.getByRole('status')).toHaveText('26 sent, 0 failed');
  expect(pageErrors).toEqual([]);
});

test('volunteer uses manual fallback, sees referral/name/bib, live count and undo without parent contacts', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/check-in');
  await page.getByLabel('Event ID').fill(fixtures.checkInEventId);
  await page.getByLabel('Event PIN').fill('4821');
  await page.getByRole('button', { name: 'Start check-in' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Check-in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trials home' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('navigation', { name: 'Sign in options' })).toHaveCount(0);
  await expect(page.getByText('0 of 14 arrived')).toBeVisible();
  await page.getByRole('link', { name: 'Look up by name instead' }).click();
  await page.getByLabel('Player name').fill('Checkin1 Trial');
  await page.getByRole('button', { name: 'Check in' }).first().click();
  await expect(page.getByRole('status')).toHaveText(/Checkin1 Trial, bib 1 — Refer to committee/);
  await expect(page.getByText('1 of 14 arrived')).toBeVisible();
  await expect(page.getByText(/checkin1@example\.test/)).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Undo last check-in' }).click();
  await expect(page.getByText('0 of 14 arrived')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('planner previews, publishes, regenerates without changing the prefix, and prints four landscape sheets', async ({ page, request }) => {
  await signIn(page, request);
  await page.getByRole('link', { name: 'E2E 15/U Ladies' }).click();
  await page.getByRole('link', { name: 'Plan rounds' }).click();
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
  await expect(page.getByRole('link', { name: 'Print selector sheets' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish revision' }).click();
  await expect(page.getByRole('link', { name: 'Print selector sheets' })).toBeVisible();

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
  await page.getByRole('link', { name: 'Print selector sheets' }).click();
  await expect(page.locator('.sheet-preview .sheet')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Print selector sheets' })).toBeVisible();
  await expectAccessible(page);

  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('.app-header').evaluate((element) => getComputedStyle(element).visibility)).toBe('hidden');
  expect(await page.locator('.sheets-page > header').evaluate((element) => getComputedStyle(element).display)).toBe('none');
  const pdf = await page.pdf({ path: '/tmp/netball-e2e-selector-sheets.pdf', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  const pdfString = Buffer.from(pdf).toString('latin1');
  expect(pdfString.match(/\/Type\s*\/Page\b/g) ?? []).toHaveLength(4);
  const mediaBox = pdfString.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
  expect(mediaBox).not.toBeNull();
  expect(Number(mediaBox?.[1])).toBeGreaterThan(Number(mediaBox?.[2]));
});
