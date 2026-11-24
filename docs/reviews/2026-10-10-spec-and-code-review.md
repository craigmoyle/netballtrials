# Spec, code quality, and security review

Date: 10 October 2026  
Reviewed commit: `e9432a9a7fea173859f2333b458c092d9139f406`  
Scope: local design spec, PRODUCT.md, API and web application source, shared types, Prisma schema and migrations, all 48 test files, package/build configuration.

## Verdict

**Do not deploy for club use yet.** The application is a useful prototype, but it does not meet the spec's acceptance checks. Several issues are financial, privacy, or trial-day correctness problems, not deployment polish. The previous statement that the project was functionally complete was too strong.

There are **31 grouped findings: 1 P0, 14 P1, and 16 P2**. P0 means an unsafe configuration must be blocked immediately; P1 means a release-blocking correctness, security, or required-workflow gap; P2 means an important robustness, maintainability, or usability issue. Grouped findings can contain several related defects.

No application code was changed. This report is the deliverable; fixes should follow as separately tested changes.

### Verification performed

| Check | Result |
|---|---|
| `npm test` | API: 114 tests / 37 files passed. Web: 13 tests / 11 files passed. |
| `npm run build` | Passed. |
| `npx tsc -p apps/web/tsconfig.json --noEmit` | Passed. |
| Additional unused-local/parameter checks | Found an unused `eventPatchSchema` import and an unused `active` variable. |
| `npm audit --json` | 4 high-severity affected package nodes, through Prisma tooling; details below. |
| `npm audit --omit=dev --json` | Same four nodes remain in the dependency graph. |
| Impeccable mechanical detector | No findings. This did not detect the functional or accessibility gaps below. |
| Isolated API/service probes | Reproduced payment, event lifecycle, CORS configuration, retention, revocation, race, and planner failures. |
| Seven ad hoc React/jsdom checks | Confirmed login, review-note, scanner retry, camera cleanup, ticket, referral, and send-result defects. Temporary test file removed. |
| Planner timing, 71 players / 5 courts | 20 seeds produced valid baseline plans; median 2.67 ms, maximum 4.65 ms locally, after warm-up. Not a production-load benchmark. |

All database probes used `netballtrials_test`, explicitly guarded against another database. They created and removed their own event/user fixtures. Mail and payment probes used fakes or locally generated Stripe test signatures; no real payment, email, or production system was touched. Concurrent-operation probes synchronised reads to reproduce a valid overlapping interleaving.

Transient source snapshots, probe scripts, and logs are in `/tmp/netball-review/`. The findings below describe the reproductions so the report remains useful after temporary files expire.

Limitations: this was an in-session review, not an independent second reviewer or a penetration test. No live Stripe account, real mail provider, hosting environment, physical camera, mobile browser, screen reader, or printed output was tested. Frontend conclusions come from source inspection and jsdom, not a WCAG conformance assessment.

## P0 — block unsafe deployment

### R01. Missing Stripe configuration silently enables forged payments

**Location:** `apps/api/src/app.ts:35–46`; `apps/api/src/payments/fake.ts:22–30`; `apps/api/src/env.ts:12–13`.

When either Stripe secret is missing, `createApp` selects the fake provider. That provider accepts the literal header `stripe-signature: ok` and trusts a caller-supplied completion event. There is no production-mode guard.

**Confirmed:** with `NODE_ENV=production`, no Stripe credentials, and a synthetic pending registration, posting a fake completion returned HTTP 200 and marked the record `PAID`. A caller who creates a registration receives its ID and knows the fee, so the necessary values are available to an unauthenticated registrant. This is conditional on misconfiguration, but it is also the default configuration.

**Fix:** fail startup in production when payment configuration is incomplete. Select the fake provider only through an explicit test/development mode or dependency injection. Add a production-configuration regression test that proves fake signatures cannot be accepted. Do not rely on remembering to set both secrets correctly.

## P1 — fix before release

### R02. Signed Stripe events are not checked for settlement, currency, or checkout identity

**Location:** `apps/api/src/payments/stripe.ts:44–52`; `apps/api/src/payments/provider.ts:16–23`; `apps/api/src/payments/webhook.ts:17–37`.

The adapter maps every `checkout.session.completed` to a payment completion, without checking `payment_status`. The service checks only registration ID and amount. It ignores `sessionId` and drops currency entirely. `paymentRef` is also overloaded: checkout creation stores a session ID there, and confirmation overwrites it with a payment-intent reference.

**Confirmed:** a locally signed test event with `payment_status: unpaid`, currency `usd`, and a different checkout session still marked an AUD registration `PAID`.

**Fix:** retain a separate checkout-session ID; validate it, the amount, currency, and settled payment state before accepting payment. Explicitly support delayed-payment success/failure events if such methods are enabled, or restrict Checkout to the supported payment methods. Test the real Stripe adapter, not only the fake event shape.

### R03. Payment idempotency fails under concurrency and revives withdrawn registrations

**Location:** `apps/api/src/payments/webhook.ts:17–39,67–84`.

Confirmation performs a read followed by an unconditional update. Two overlapping deliveries can both read `PENDING`, issue different QR tokens, and both report that this was a new payment. Sequential replay after withdrawal also changes `WITHDRAWN` back to `PAID`, because only the `PAID` state is treated as already processed.

**Confirmed:** synchronised concurrent calls both returned `alreadyPaid: false` and generated two distinct tokens. Replaying a completion after withdrawal restored `PAID`.

**Impact:** duplicate confirmation emails, invalidated QR codes, and reinstatement of a player intentionally removed from the roster. Delayed events for old/expired attempts also lack a defined reconciliation path.

**Fix:** use an atomic, state-qualified transition and durable event/session idempotency. Preserve withdrawal and anonymisation decisions. Issue a QR once, retain it, and separate confirmation delivery/retry from the payment transition. Test overlapping deliveries and replays after withdrawal and retention.

### R04. Default browser/API origins are incompatible with credentialed fetch

**Location:** `apps/api/src/app.ts:53`; `apps/web/src/api/client.ts:18–22`; `apps/web/src/App.tsx:21`; `apps/web/vite.config.ts:6`.

The web app defaults to port 5173 and the API to port 3000. All API requests use `credentials: 'include'`, but CORS is configured without `credentials: true` and there is no Vite API proxy.

**Confirmed:** an authenticated `/api/auth/me` response to origin `http://localhost:5173` returned the allowed origin but no `Access-Control-Allow-Credentials` header. A browser must reject access to that credentialed response. Fastify injection and mocked-fetch tests do not exercise browser CORS enforcement.

**Fix:** use a same-origin `/api` proxy in development and deployment, or deliberately configure exact allowed origins, credentialed CORS, and matching cookie policy. Add a real-browser login/public-registration smoke test. Do not use wildcard origins with credentials.

### R05. Administrators cannot open or close registration through the application

**Location:** `apps/api/prisma/schema.prisma:78`; `apps/api/src/events/schemas.ts:7–28`; `apps/api/src/events/service.ts:11–33,54–56,77–102`; `apps/web/src/routes/EventFormPage.tsx`.

New events default to `DRAFT`. Neither the event input schema nor `toEventData` supports status transitions, and there is no separate open/close route. Public registration requires `OPEN`. Supplying a status in a patch is silently stripped.

**Confirmed:** create returned 201; patching `{ status: 'OPEN' }` returned 200 but left the event `DRAFT`; the public event endpoint still returned 404. Tests bypass this by inserting `OPEN` events directly into Prisma.

**Fix:** add explicit, validated admin lifecycle operations and UI controls. Test the complete create → open → register → close flow through the API, without directly editing the database.

### R06. The planner never increases the round count beyond its lower bound

**Location:** `apps/api/src/planner/generate.ts:118–172,291–299`; `apps/api/src/planner/types.ts:17–26`; `apps/api/src/tests/planner/gaps.test.ts:23–32`.

`buildPlan` computes one minimum and tries three seeds at that same round count. It never increases rounds to find a feasible schedule, and ignores `input.rounds`. The spec explicitly requires increasing rounds until a valid plan exists or the playing window is exhausted.

**Confirmed:** 14 opted-in players all selecting GS, minimum one GS game each, and a 600-minute window were declared infeasible at one round. A hand-built seven-round, 68-minute plan passed the existing checker with no gaps.

**Fix:** distinguish a lower bound from proof of infeasibility. Search permitted round counts within the window and support a validated organiser-selected count. Position-demand bounds should inform that search, not reject the entire event prematurely.

The current all-GS/minimum-three gap test also encodes the wrong expectation for its generous window: enough additional rounds can satisfy that case. Tighten the window if the intention is to test genuine infeasibility.

### R07. Feasible schedules depend on the players arriving in a convenient order

**Location:** `apps/api/src/planner/generate.ts:75–115,181–198,240–251`; `apps/api/src/planner/service.ts:22–24`.

Court groups are determined by player-array index modulo court count, independently of position restrictions. If an initial group cannot fill each position, generation stops. The seeds change ordering within groups, not the fundamental grouping; there is no repairing search across courts.

**Confirmed:** a feasible 28-player, two-court roster with four players per position and no extra-position opt-ins failed simply by swapping the first two input entries. A constructed two-round schedule for the same players passed the checker. In production the input is ordered by bib, so arrival order can trigger this.

**Fix:** account for allowed positions during court assignment and add bounded matching/repair across groups. Test permutations of the same roster, non-opted-in players, mixed rank choices, and uneven position demand. Keep a known valid witness for negative generator tests so a heuristic failure is not mistaken for mathematical infeasibility.

### R08. Regeneration saves an invalid composite schedule as published

**Location:** `apps/api/src/planner/service.ts:120–187`; `apps/api/src/tests/planner/service.test.ts:24–38`.

Regeneration generates a fresh full schedule with no knowledge of played rounds, discards its prefix, and combines its suffix with the old prefix. It never validates the composite plan. The existing published status is retained. The test only checks that old rows are unchanged, not that the replacement remains valid after a roster change.

**Confirmed:** start with 30 players on two courts, publish three rounds, add a 31st player after two rounds, and regenerate from round 3. The method returned `ok: true` and retained `PUBLISHED`, but the saved plan failed three court-visit checks, the late player's GS minimum, and game balance (one to three games). Played rounds were indeed unchanged; that alone is insufficient.

**Fix:** plan the suffix using residual court visits, rank quotas, appearance counts, and time after the frozen prefix. Validate the complete result before writing, atomically. Reject with actionable gaps when the late-arrival requirements cannot fit. Bound `fromRound`, define the source published revision, and require explicit approval before republishing. Add real late-arrival and withdrawal tests.

### R09. The authoritative plan checker accepts invalid slot coordinates

**Location:** `apps/api/src/planner/verify.ts:19–57,73–77`; `apps/api/prisma/schema.prisma:182–192`.

The checker counts slots and duplicates, but does not validate integer/range constraints on round, court, or team, membership of every registration, or the exact expected position/team grid in each round/court. Unknown registration IDs are skipped in the position restriction check. Database constraints do not supply these missing checks.

**Confirmed:** a plan declaring one round but containing all slots in round 99 and teams 7/8 returned an empty gap list.

**Fix:** validate the full runtime structure, each slot's membership and coordinates, and exact occupancy of every expected place. Add suitable unique/check/foreign-key constraints as a second layer, with an explicit policy for historical slots and retained/anonymised registrations. Test malformed plans independently of the generator.

### R10. Closing check-in or revoking the PIN does not revoke volunteer access

**Location:** `apps/api/src/checkin/service.ts:6–38,131–145,190–200`; `apps/api/src/checkin/routes.ts:133–173`.

Changing/clearing the PIN updates only the event. Existing sessions remain valid. Session resolution checks only token expiry, not whether the event PIN is still active or check-in is closed. Mutations consequently continue after the admin has finalised the roster.

**Confirmed:** opened a volunteer session, cleared the PIN, closed check-in, then used that same cookie to check in another player successfully (HTTP 200, `checked_in`).

A related race exists between withdrawal and check-in: the paid-state check occurs before the transaction, while the atomic update only checks `checkedInAt: null`. A reproduced interleaving left a `WITHDRAWN` registration checked in and returned success.

**Fix:** revoke or version sessions when the PIN changes; enforce event closure on every mutation and define a separate admin late-arrival path. Recheck paid status and event state at the atomic write boundary. Use Melbourne calendar boundaries for expiry: the current UTC expiry permits use until about 10 am on the second day after a September event.

### R11. Retention leaves personal information behind

**Location:** `apps/api/src/retention/service.ts:9–32`; `apps/api/prisma/schema.prisma:195–225`.

Retention only blanks selected registration columns. `EmailLog.to`, subject/body/error, `ReviewItem.note`, and `Registration.checkedInBy` remain. Those can contain names, contact information, and sensitive review information. Repeat runs update and count the same records again, overwrite their update timestamp, and there is no explicit anonymised marker or retained status history.

**Confirmed:** after retention, the registration's parent email was blank but the email log retained the address, a review note retained birth-certificate discussion, and the check-in operator field remained. A second run returned one changed registration again.

**Fix:** inventory personal information across all related tables and free text; delete or anonymise it transactionally. Add an anonymisation marker, preserve only agreed reporting/payment fields, and test related records and repeated execution. Document backup/export retention separately. A function that clears one table is not a complete privacy policy.

### R12. The default mail configuration falsely records successful delivery

**Location:** `apps/api/src/app.ts:43–46`; `apps/api/src/mail/dev-mailer.ts:3–10`; `apps/api/src/scripts/send-reminders.ts:5–10`; `apps/api/src/mail/provider.ts`; `apps/api/src/env.ts:10–11`.

The app and reminder script always use an in-memory mailer unless manually overridden in code. The script has no production-provider selection. It can mark reminders as sent even though nothing left the process; subsequent runs then skip those events. Authentication links are also undeliverable in a normal standalone deployment. The in-memory sink retains every message indefinitely while the process lives.

Choosing a provider was legitimately deferred, but pretending deliveries succeeded is not a safe deferred state. From/reply-to settings exist but are not wired to this interface/implementation.

**Fix:** require explicit provider configuration for real operation. Make development delivery conspicuous and ensure it cannot write production success logs. Provide a dry-run mode that does not mark delivery. Keep the small provider interface; it is useful, intentional abstraction, not duplication to delete.

### R13. Payment confirmation does not deliver the promised ticket/calendar flow

**Location:** `apps/api/src/payments/webhook.ts:77–84`; `apps/api/src/registrations/confirmation.ts:79–103`; `apps/web/src/routes/TicketPage.tsx:34–41`; `apps/web/src/routes/RegistrationPendingPage.tsx:45–50`; `apps/api/src/mail/provider.ts:1–6`.

The confirmation email links to the JSON API ticket URL, not the web ticket page. The web ticket page displays no QR image/canvas/SVG. The paid success page only tells the parent to check email. Neither offers a calendar download.

An ICS string is computed and passed into `buildConfirmation` but never attached or included; the mail interface has no attachment field. The calendar dates are also constructed from first whistle as UTC, with the same start and end instant, rather than the event's Melbourne arrival/finish times. The email nevertheless says a calendar file is attached.

Confirmation-delivery exceptions are swallowed without an email log or retry path. A webhook retry sees `alreadyPaid` and never retries the email.

**Confirmed:** the captured email had only `to`, `subject`, `text`, and `html`, its ticket link targeted `/api/public/ticket/...`, and no email log existed. An additional frontend test confirmed the ticket contains no QR or download control.

**Fix:** implement the actual browser ticket/QR and secure paid-return flow, attach/download ICS using the correct timezone and event times, and audit/retry confirmation separately from payment state. Escape and fold ICS content according to its format. Do not expose ticket tokens merely by adding them to the unauthenticated registration-ID status endpoint without reviewing that authorisation boundary.

### R14. Essential admin workflows are absent or unreachable

**Location:** `apps/web/src/AdminLayout.tsx:9–25`; `apps/web/src/routes/EventsPage.tsx:34–51`; `apps/web/src/routes/EventFormPage.tsx`; `apps/web/src/App.tsx:130–136`; API route inventory.

The console links only to the event list/editor. Planner, review, messaging, and sheets routes exist but have no event navigation. There is no staff-facing roster/contact view, position-choice/extra-opt-in counts, roster export, association-maintenance UI, PIN management/close-check-in UI, or documented first-admin/invitation provisioning path. Non-flagged registrations are not available in a roster for withdrawal. Only tests create staff users.

The planner page exposes controls but no actual schedule preview or pre-generation minimum/time-window summary. There is no policy PDF upload despite the required optional attachment capability.

**Fix:** implement the minimum complete event workflow and link it from the console. Reuse the existing API operations where available; do not add a generic dashboard framework. Separate “implemented endpoint” from “usable feature” in acceptance testing. See the coverage matrix below.

### R15. Duplicate detection exposes a registration-existence oracle

**Location:** `apps/api/src/public/routes.ts:69–80`; `apps/api/src/registrations/service.ts:97–100`; `apps/api/src/tests/public/registration.test.ts:31–35`.

For a supplied event, normalised player name, and date of birth, the API distinguishes an existing active registration (`409 { error: 'duplicate' }`) from a new one (201 plus checkout data). Neutral wording in the React page does not hide that distinction from an API caller. There is no public registration rate limit. The spec expressly says the response must not confirm another family's registration.

The required resend-to-original-address recovery and legitimate duplicate-exception admin workflow are also missing. The current test explicitly asserts the revealing error while claiming it does not confirm existence.

**Fix:** agree and implement privacy-preserving duplicate/recovery semantics at the API level, combined with abuse controls. Recovery must send only to the already recorded address, never an address supplied by the duplicate attempt. Keep the database uniqueness constraint. If the product intentionally accepts this disclosure trade-off, change the spec explicitly rather than claiming the current response is private.

## P2 — robustness, quality, and maintainability

### R16. Checkout failures strand registrations; expiry is incomplete

**Location:** `apps/api/src/public/routes.ts:46–66`; `apps/api/src/registrations/service.ts:36–44,67`; `apps/api/src/payments/stripe.ts:44–55`; `apps/web/src/routes/RegistrationPendingPage.tsx:23–28`.

A pending registration is saved before provider checkout. Provider failure leaves it blocking retries for up to 24 hours. Expiry is updated only during a later registration attempt for the same event, not by the status endpoint or expired/failed Stripe events. The pending page even continues polling `EXPIRED` records.

**Confirmed:** simulated checkout failure returned 500; retry returned 409 duplicate; the pending record remained. A registration past `expiresAt` still returned `PENDING` from the status endpoint.

**Fix:** use an idempotent checkout attempt with an explicit recovery/failure state. Do not simply release a slot when a timeout may have created a real checkout; reconcile with Stripe. Process expiry/failure events or scheduled expiry, make status reads accurate, and stop polling terminal states.

### R17. Reminder retries and email audit records are unreliable

**Location:** `apps/api/src/messages/reminders.ts:42–70`; `apps/api/src/messages/service.ts:26–54`; `apps/api/src/review/routes.ts:75–89`; `apps/api/prisma/schema.prisma:211–225`.

Any reminder log for an event suppresses all future reminder attempts, including failed deliveries and recipients not reached before a crash. Parallel runs can both observe no logs and send duplicates. This is more than the previously noted send-before-log crash risk.

The service uses first whistle, while the spec calls for 24 hours before event start/arrival. The subject always says “tomorrow” even if a delayed job runs on the event day. Failure rows get a default `sentAt`; a log-write failure after a successful send is also treated as a delivery failure. The sender user ID is never recorded, and the log API omits the message body despite the audit requirement. Confirmation emails do not use this log at all.

**Confirmed:** one SMTP failure produced a failure log; the next run attempted zero deliveries. The original reminder test's “8 hours before” comment is also wrong: its timestamps are 22 hours apart in Melbourne.

**Fix:** claim and track delivery per notification/recipient, with sent/failed/pending states, sender provenance, and retry policy. A small database-backed delivery record is enough; an external queue is not yet justified. Use the intended local event-start time. Exactly-once external email is not guaranteed by a database transaction alone.

### R18. Review notes are discarded and resolution does not clear the referral workflow

**Location:** `apps/web/src/admin/ReviewPage.tsx:32–37,64–69`; `apps/api/src/review/service.ts:46–55,66–85`; `apps/api/src/checkin/service.ts:177–221`.

The note input is never read: every resolution saves the literal `Reviewed`. The frontend test only asserts that some string was sent. Withdrawal refreshes a queue that still lists withdrawn registrations' unresolved items. Resolving an age review leaves `ageFlagged` true, and check-in uses that raw flag rather than unresolved review state, so the family is still referred after review.

**Confirmed:** entering “Verified birth certificate” and clicking Mark reviewed sent `Reviewed` instead.

**Fix:** submit the actual labelled field; test its exact value. Distinguish the historical age flag from an outstanding committee referral. Define and implement withdrawal/resolution visibility rather than leaving an endless queue entry.

### R19. Concurrent review-list requests create duplicate review items

**Location:** `apps/api/src/review/service.ts:22–42`; `apps/api/prisma/schema.prisma:195–208`.

`ensureReviewItems` checks for missing records and then inserts, but there is no unique `(registrationId, reason)` constraint. It runs on a GET and can race with another request or another application instance.

**Confirmed:** two overlapping calls created two items for one flagged registration.

**Fix:** enforce uniqueness in PostgreSQL and use a conflict-safe insert/upsert. Tests should exercise concurrent requests, not just two sequential calls. Consider whether creation belongs on registration/payment transition rather than mutating a list GET.

### R20. Scanner retries, referral results, and counts are incomplete

**Location:** `apps/web/src/checkin/ScanPage.tsx:50–65`; `apps/web/src/checkin/feedback.ts:3–11`; `apps/web/src/checkin/CheckInLayout.tsx:10–23`; `apps/web/src/checkin/LookupPanel.tsx:36–47`.

`lastToken` is set before the request and never expires or resets, so the same QR cannot be retried after a transient request failure. The referral branch replaces the whole result with “Refer to committee”, hiding an assigned bib and the player name. The arrival count loads only on mount; manual results are not refreshed after check-in. Scanner results have no undo control or registration ID to drive one; undo is offered only after a fresh manual check-in.

**Confirmed:** retrying the same QR after failure and a two-second cooldown made no second API call. A flagged successful result with bib 4 produced only the referral text.

**Fix:** use a bounded decode cooldown that clears on failure, preserve normal result/bib details alongside the neutral referral, expose authorised undo for scans, and refresh attendance/query state after mutations.

### R21. Camera and audio resources leak

**Location:** `apps/web/src/checkin/ScanPage.tsx:8–20,39–81`.

If camera startup finishes after the effect has been cleaned up, the newly returned scanner controls are never stopped. A new AudioContext is created for every result and never closed. Timers and request callbacks also survive unmount.

**Confirmed:** unmounted the scanner while mocked camera startup was pending, then completed startup; `controls.stop()` was never called.

**Fix:** stop controls immediately if startup completes after cancellation, guard async callbacks, cancel timers, and reuse or close one audio context. Request an appropriate camera and test denied permission/background/unmount paths. Physical-device sound and camera behaviour remain untested.

### R22. Magic-link verification hangs under the shipped development Strict Mode

**Location:** `apps/web/src/main.tsx:6–11`; `apps/web/src/routes/VerifyPage.tsx:16–44`.

The first effect sets `started.current`, then Strict Mode cleanup sets its local `active` flag false. The second setup returns early because `started` is already true. The original request may consume the one-time token, but neither setup updates the UI.

**Confirmed:** in Strict Mode, the verify API was called once, the signed-in callback was never called, and the UI stayed on “Signing you in…”. The existing test does not render Strict Mode. This exact effect replay is development-only; it is not a claim that every production login hangs.

**Fix:** make the one-time request/result lifecycle resilient to effect replay and parent rerenders, without re-consuming the token. Include Strict Mode in the test and clear sensitive tokens from the URL after processing.

### R23. Publishing and printing do not establish an immutable reviewed schedule

**Location:** `apps/api/src/planner/routes.ts:53–58,118–168`; `apps/api/src/planner/service.ts:103–117`; `apps/api/src/planner/sheets.ts:36–73`; `apps/web/src/planner/SheetsPage.tsx:24–31`.

The sheets route prints the latest plan regardless of `DRAFT`/`PUBLISHED`. Printing joins multiple complete HTML documents. Injected styles target global `header`, `h1`, `table`, and `body`, so they affect the admin shell. The `no-print` class has no CSS rule; the shell and Print button are not hidden. The last sheet forces a page break.

Publication does not revalidate the roster/settings or freeze input/bib data. Sheets join current registrations, so a withdrawal clearing a bib can change even the display of a played round. Old published plans can coexist with a newer draft and the loader silently chooses the newest.

**Confirmed:** a draft produced HTTP 200 with four separate doctypes for a two-court/two-round plan.

**Fix:** select an explicit published revision, snapshot the input/display fields needed for reproducibility, and revalidate before publication. Render one HTML document with scoped sheet sections and print-specific shell hiding, or a dedicated print document. Test draft rejection, stale rosters, multiple sheets, and printed pagination in a browser.

### R24. Input validation and eligibility/policy capture do not match the product rules

**Location:** `apps/api/src/registrations/schemas.ts:17–41`; `apps/api/src/events/schemas.ts:7–28`; `apps/api/src/registrations/service.ts:69–94`; `apps/web/src/routes/RegisterPage.tsx:131–157`; `apps/web/src/routes/EventFormPage.tsx:26–28`.

Date schemas check format only: impossible dates can normalise to a different day or fail later as server errors. A third rank is allowed without a second, which lets a client use the third-rank minimum without the intended second rank. The association list is not consulted: public registration accepts arbitrary free text and cannot select the maintained active list.

Age defaults remain 5–99 rather than policy-derived division defaults. Existing age flags are not recomputed when competition year/age limits change. With no custom policy URL, registration renders `href="#"`, while the server records the default published policy as if it had been shown. The form neither states the six-game/permanent-player eligibility details nor links to privacy information.

**Confirmed:** `2026-02-31` passes the event schema. The policy/default and rank issues are directly visible in the request and UI paths.

**Fix:** validate real calendar dates and sensible DOB bounds, ranked-choice ordering, active associations, and supported URL schemes. Provide correct age presets and an explicit re-review policy on event changes. Show the exact policy/eligibility text that is recorded, include privacy information, and support clearing an optional custom policy URL (currently omitting an empty field preserves the old value).

### R25. Confirmation HTML interpolates URLs without escaping attributes

**Location:** `apps/api/src/events/schemas.ts:27`; `apps/api/src/registrations/confirmation.ts:50–59`.

Names and event text are escaped, but `ticketUrl`, `policyUrl`, and QR source are inserted directly into quoted HTML attributes. Generic URL validation does not guarantee safe HTML interpolation or an approved scheme.

**Confirmed:** an accepted policy URL containing a quote and a `<b data-audit="injected">` fragment created an actual HTML element in the email template.

**Fix:** validate policy URLs as HTTP(S) and HTML-escape attribute values consistently. Keep user text escaped in sheets. This demonstrated path requires an admin-controlled policy URL; it is not evidence of unauthenticated browser XSS, and email-client sanitisation was not tested.

### R26. Several failed actions have no truthful recovery UI

**Location:** `apps/web/src/planner/PlannerPage.tsx:39–75`; `apps/web/src/checkin/LookupPanel.tsx:36–47`; `apps/web/src/admin/MessagesPage.tsx:28–40,63–75`; `apps/web/src/routes/RegisterPage.tsx:79–88`; `apps/web/src/planner/SheetsPage.tsx:16–18`.

Planner actions and manual check-in/undo have no catch/alert path. Print-load errors become an empty page. A registration request error replaces the form entirely despite saying “try again”. Messages ignore `{ sent, failed }`, clear the draft even if every delivery failed, and never show the recipient count required by the plan. A log-refresh failure after a successful send is reported as a send failure, inviting duplicate sends.

**Confirmed:** `{ sent: 0, failed: 3 }` cleared the message form and left no error alert.

**Fix:** preserve drafts, distinguish mutation success from refresh failure, show partial-delivery results and retry options, and provide labelled retry/navigation controls. Disable both submission paths while sending and snapshot the confirmed subject/body/recipient set.

### R27. Public accessibility and visual acceptance remain unverified and incomplete

**Location:** `apps/web/src/routes/RegisterPage.tsx:102–159`; `apps/web/src/App.tsx`; `apps/web/index.html`; `apps/web/src/checkin/ScanPage.tsx:86–98`.

The public form says fields are “highlighted”, but does not mark or describe the invalid controls. It uses internal field identifiers in the error summary and disables native validation without equivalent field-level feedback. Loading/success transitions lack consistent announcements/focus handling, and all pages share the “Netball Trials Admin” title.

There is no application stylesheet or coherent public/mobile layout/branding implementation. The scanner has a large text result, but its tone attribute has no visual styling. Responsive/touch-target and printed layout requirements have not been verified on actual devices. Most controls do have labels and native keyboard behaviour; do not throw that away in a redesign.

**Fix:** implement the small branded public shell and form error/focus pattern, then test keyboard use, zoom, narrow viewports, touch targets, screen-reader output, and outdoor scanner contrast. WCAG 2.2 AA cannot be claimed from passing jsdom tests. Relevant criteria include error identification/instructions (3.3.1/3.3.2), status messages (4.1.3), reflow (1.4.10), and target size (2.5.8); do not substitute a blanket 44px rule for the actual AA criterion and its exceptions.

### R28. Production authentication and abuse protections need explicit configuration

**Location:** `apps/api/src/auth/routes.ts:20–31,50–55`; `apps/api/src/auth/service.ts:32–50`; `apps/api/src/env.ts:4–14`; `apps/api/src/app.ts:50–54`; `apps/api/src/checkin/pin.ts:19`; `apps/api/src/checkin/limiter.ts`.

Login-link and registration endpoints have no application rate limits. Repeated link requests invalidate earlier links and can deny a known admin access as well as create mail load. PIN hashing runs synchronously on the request thread; the limiter is process-local, never evicts stale keys globally, and depends on an undefined reverse-proxy/IP policy. Successful PIN logins are not rate limited.

Secure cookies default off, request logging is disabled, and no application security-header, sensitive-response cache policy, or Origin/CSRF check is configured. SameSite=Lax is useful protection and there is no demonstrated cross-site CSRF exploit here; same-site deployment boundaries and bodyless mutation endpoints still merit deliberate review. Proxy/TLS/header protections could exist outside this repo, but none were supplied.

**Fix:** validate production environment and cookie policy, add bounded abuse controls, use async scrypt, define trusted proxy configuration, and implement appropriate Origin/CSRF and response-header policy. Enable structured error/operation logs while redacting tokens, contacts, and webhook payloads. Keep sensitive ticket/session responses out of shared caches.

### R29. Dependency audit reports a vulnerable Prisma tooling chain

**Location:** `apps/api/package.json:21–35`; `package-lock.json`.

The audit reports four high-severity affected nodes: `prisma`, `@prisma/config`, `deepmerge-ts`, and `mysql2`. These are propagation nodes, not four independently proven remote application exploits.

Underlying advisories include recursive-merge stack exhaustion in deepmerge-ts (`GHSA-ggr8-5vv4-36mx`) and MySQL2 authentication downgrade/decompression issues (`GHSA-3f6p-5ww8-9rcr`, `GHSA-rgwj-5xj2-c3m3`). `npm explain` traces MySQL2 3.15.3 through Prisma 7.10.0. This application uses PostgreSQL; no MySQL connection path was found. Prisma also remains in the omit-dev graph through the client's optional peer relationship.

**Fix:** choose compatible patched dependency versions, review the actual runtime image/install graph, and rerun migration/client-generation tests. Do not blindly run `npm audit fix --force`: the offered change is a major downgrade to Prisma 6.19.3, not a verified compatible remedy.

### R30. Runtime packaging and operational setup are incomplete

**Location:** `apps/api/package.json:10–16,29–35`; `apps/api/src/index.ts`; `apps/api/src/db.ts`; `apps/api/src/scripts/*`; repository root.

`start` and job scripts require `tsx`, but it is a devDependency. The API build is typecheck-only (`noEmit`), so a conventional production-only install has no compiled fallback. Runtime entrypoints do not load `.env`; Prisma CLI/tests load configuration differently from the server/jobs. No README/runbook documents admin provisioning, generation/migrations, public/API origins, provider setup, or job execution. No scheduler/CI workflow is committed.

**Fix:** decide and verify one reproducible deployment contract: compile the API or explicitly ship its TypeScript runtime, generate Prisma, migrate safely, and load environment consistently. Add a short runbook and a clean-checkout CI smoke test. Hosting and cron selection are legitimately open decisions, but the commands must not silently use development defaults against the wrong database.

### R31. The current tests overstate acceptance coverage

**Location:** `apps/api/src/tests/planner/{verify,fairness,service,gaps}.test.ts`; `apps/api/src/tests/registrations/confirmation.test.ts`; `apps/web/src/**/*.test.tsx`; `apps/api/vitest.config.ts`.

Several tests assert labels or broad bounds, not the behaviour named in their titles:

- “Calendar data” never asserts an attachment or emitted calendar content.
- The checker double-booking test is also short on slots, so a slot-count check alone can pass it.
- The fairness threshold is weaker than the worst possible repeated-opponent count for the two-round fixture; the extra-position bound is similarly uninformative.
- Regeneration never introduces a late arrival or withdrawal and never checks the combined schedule.
- “Checked-in only” starts with everyone checked in, so exclusion is not tested.
- PIN, webhook, reminder, and review idempotency are largely sequential tests.
- Most frontend clients are cast to `any`; no browser CORS or complete navigation/payment/check-in flow is exercised.

**Fix:** add focused regressions for this report, then a small number of end-to-end acceptance journeys. Use exact expected fairness metrics on hand-built plans, permutation tests and feasible witnesses for the planner, real-adapter payment tests, concurrency tests, and Strict Mode UI tests. Keep the isolated test-database guard. No new test framework is necessary for most of these additions.

## Spec coverage matrix

| Requirement | Current state | Needed before acceptance |
|---|---|---|
| Single club, no multi-tenancy | Implemented | Keep simple; no tenancy framework needed. |
| Invite-only staff access | Existing-user lookup and one-time tokens work | Document/implement authorised first-admin/invite provisioning; real delivery and browser login. |
| Event/division/year/time/fee setup | Basic fields and window ordering implemented | Open/close registration, policy age presets, lifecycle tests. |
| Optional PDF selection policy | Not implemented | Upload/storage/validation path or an explicitly agreed spec reduction. |
| Parent/player details and 1–3 ranked choices | Mostly implemented | Real date/rank/association validation and exact eligibility/policy/privacy presentation. |
| Sibling registrations and active-player uniqueness | DB unique index implemented | Preserve uniqueness; fix privacy/recovery and stale-attempt handling. |
| Duplicate exceptions and original-address resend | Missing | Explicit authorised exception and neutral recovery paths. |
| Stripe payment confirmed only after settlement | Partial | R01–R03 and checkout expiry/failure reconciliation. |
| QR ticket on paid return and ticket page | Missing in web flow | Actual QR rendering and correct secure ticket handoff. |
| Confirmation QR/calendar/policy | QR image generator exists | Correct links, usable ICS attachment/download/timezone, audited retry. |
| Age review queue with notes | Partial | Save entered notes, prevent race duplicates, handle resolved/withdrawn referrals. |
| PIN-based check-in, bibs, counts, undo | Basic API works | Admin controls, revocation/closure, atomic status guard, scanner retry/undo/live counts. |
| Roster/contact access, position counts, export | Missing | Minimal authorised roster page/API/export; required before retention. |
| Exclude no-shows | Query filters checked-in paid rows | Add tests with real no-shows and concurrent withdrawal. |
| Hard-constrained planning | Some baseline fixtures work | Round-count expansion, order-independent construction, stronger verifier. |
| Fairness optimisation | Best-of-three lexicographic scoring exists | Meaningful metric tests and improved candidate diversity after feasibility is correct. |
| Organiser round count and pre-generation preview | Missing | Validated settings/minimum/time budget and a schedule review UI. |
| Publish/freeze/late arrival regeneration | Unsafe | Residual constraints, composite verification, revision/snapshot semantics. |
| Landscape sheets | Basic renderer exists | One valid print document, publish gating, snapshots, print/browser testing. |
| Event messages with sender/time/text log | Partial | Real provider, provenance/body visibility, recipient confirmation, accurate failure/retry UI. |
| Melbourne day-before reminders | Partial | Correct event start, per-recipient claims/retries, real provider and scheduling. |
| 12-month personal-data retention | Incomplete | Related-table/free-text cleanup, idempotence, reporting policy, export/runbook. |
| Chisholm branding and WCAG 2.2 AA public pages | Not demonstrated | Branded accessible forms/ticket and actual browser/device assessment. |

### Spec/plan decisions needing clarification

1. **The design spec should outrank the implementation-plan snippets.** The round-count search requirement is explicit, but a plan test treats an all-GS roster as infeasible without constraining the available time sufficiently. Fix the test; do not weaken the product requirement silently.
2. **Late arrivals versus hard fairness/coverage rules.** Someone arriving near the end may not be able to visit every court or finish within one game of early arrivals. The product needs a clear policy: add rounds within the window, reject with gaps, or obtain an explicitly documented exception. Saving a violating schedule is not an acceptable implicit policy.
3. **Eligibility competition year.** The spec ties six association games to 1 January of the competition year, while example trials take place in September of the preceding year. Confirm the intended eligibility period with the club and use it consistently in the consent text.
4. **Retention duration/reporting.** Decide whether “12 months” means calendar months or exactly 365 days, and what payment/status history must survive. The current model has a single mutable status, not a status history.
5. **Deferred provider/hosting versus implemented behaviour.** Provider choice and scheduling are open; delivery must fail safely or be visibly dry-run until those choices are made. They cannot count as successful user-facing capabilities yet.

## Optimisation and duplication review

Correctness is the priority. The measured baseline planner is already fast for the target roster size; its false infeasibility and regeneration behaviour matter far more than shaving milliseconds.

### Ranked simplifications

1. **reuse:** Replace six local copies of `eventFixture` and two registration-fixture copies with `apps/api/src/tests/helpers/fixtures.ts`. Use typed override inputs rather than `Record<string, unknown>` where practical. This removes drift and makes missing required fields harder to hide. [`apps/api/src/tests/{public,payments,registrations}/*`]
2. **reuse:** Consolidate the four HTTP transport/error-parsing implementations (`request`, `planAction`, `sendMessage`, `getSheetsHtml`) into one small fetch helper with JSON/text handling and a consistent typed error payload. Preserve the planner's deliberate 422 result; do not turn errors into empty data. [`apps/web/src/api/client.ts:15–54,134–167`]
3. **reuse:** Extract one slot-persistence mapping and one registration-to-planner-player mapping instead of maintaining repeated copies. Retain transaction boundaries and validate the final plan; this is a small helper, not a generic repository framework. [`apps/api/src/planner/service.ts:27–35,87–95,155–177`; `apps/api/src/planner/routes.ts:126–135`]
4. **reuse:** Share API-contract types and ordered positions instead of redefining `CheckInResult`, `CheckInSummary`, public event/ticket shapes, Position unions, and position-order arrays. Keep persistence models distinct from public DTOs; a shared type must not accidentally expose contacts or hashes. Align optional/nullable policy input types so `as never` is unnecessary. [`packages/types/src/index.ts`; `apps/api/src/{checkin,public,planner,registrations}`; `apps/web/src/routes/RegisterPage.tsx`]
5. **reuse:** Use one tested Melbourne date/time conversion and one HTML-attribute escaping helper for calendar, reminder, expiry, and email paths. Keep the tiny minutes-of-day helper shared between event validation and planner settings. The calendar and reminder implementations currently disagree. [`apps/api/src/registrations/{confirmation,ics}.ts`; `apps/api/src/messages/reminders.ts`; `apps/api/src/checkin/service.ts`; `apps/api/src/events/schemas.ts`]
6. **delete:** Remove the unused `eventPatchSchema` import and the ineffective `active` variable; replace the latter with real cancellation if needed. Tree-wide inspection also found exported registration type aliases used only at their declarations. Do not delete `PlannerInput.rounds` just because it is ignored: explicit round choice is a missing requirement. [`apps/api/src/events/service.ts:5`; `apps/web/src/admin/ReviewPage.tsx:24–29`; `apps/api/src/registrations/schemas.ts:4,44`]

Estimated pure-consolidation saving: **roughly 150–200 lines, zero dependencies removed**. This is an estimate, not an applied diff; correctness fixes and regression tests will add code. The dependencies generally serve real needs. Keep the payment/mail seams and the separate pure checker; deleting those would reduce testability and portability, not useful complexity.

### Low-risk performance improvements after correctness

- **Query fewer columns.** The sheet route loads all registrations including parent contacts; review/check-in/planner queries also fetch wider rows than needed. Use `select` to reduce transfer, accidental exposure, and retained sensitive data in memory.
- **Bound list work.** Paginate the email log/review/roster APIs. Query reminder events in the relevant date window, not every event followed by one log query each. Run retention in bounded batches/transactions with an anonymisation marker.
- **Use database guarantees instead of application-only races.** Review uniqueness, slot occupancy, and suitable active-plan constraints improve both correctness and simpler code. Add indexes based on actual query plans, not every field.
- **Avoid blocking the event loop.** Replace synchronous PIN scrypt; keep planner work inline while timings remain small, rather than adding workers or queues prematurely.
- **Fix round search before tuning it.** Preflight common checks once per input/round count, avoid redundant candidate work on immediate failures, and group slots once for print output rather than filtering the whole schedule for every sheet.
- **Keep the scanner chunk lazy.** The build already splits ZXing: main bundle 288.79 kB (89.78 kB gzip), scanner chunk 477.55 kB (125.21 kB gzip). Consider the installed QR-only reader and measure the result; do not claim the scanner chunk is currently loaded on every public page.
- **Do not gate public routes on `/auth/me`.** Move authentication loading into the admin boundary. Registration/ticket/check-in should not wait for an unrelated admin-auth request before their own data loads.
- **Use router links for internal navigation.** Current anchors force full reloads and repeat auth/data fetching. This is a small consistency fix, not a reason to install a state-management library.

## Frontend technical audit

**Implementation integrity: fail for release readiness.** Routes and labels exist, but several controls do not complete their claimed tasks, data-entry fields are disconnected, and the ticket is missing its core artifact. The mechanical detector returned `[]`; manual flow checks found the defects above. No detector result is being treated as visual or functional certification.

These scores are provisional source/jsdom assessments, not measured device/browser scores. Dark mode is not a product requirement and is not counted as a missing feature.

| Dimension | Score / 4 | Main evidence |
|---|---:|---|
| Accessibility | 2 | Native labels/controls are a good base; invalid-field feedback, recovery, announcements, and titles remain incomplete. |
| Performance | 3 | Small main app and lazy scanner chunk; unnecessary auth gating, resource leaks, and full-page navigation need attention. |
| Responsive design | 1 | No deliberate mobile/form layout or target-size treatment; real-device reflow and touch use unverified. |
| Theming/brand consistency | 0 | No app-level styles/tokens or required Chisholm public identity; print styles are global and leak into the shell. |
| Implementation integrity | 1 | Disconnected note input, missing QR, hidden/unreachable workflows, and inaccurate success states. |
| **Total** | **7 / 20** | **Poor; significant functional and UI work required before release.** |

Recommended frontend follow-up: `/impeccable harden` for form/error/resource handling, `/impeccable adapt` for parent/volunteer mobile use, `/impeccable optimize` for measured navigation/scanner issues, and `/impeccable polish` only after the workflows work. Run one combined browser pass at desktop/mobile sizes, then a bounded correction pass; do not spend time on open-ended visual polish before the blockers are fixed.

## What is worth keeping

- The stack and single-club scope are appropriate; no need for multi-tenancy or a new architecture framework.
- Active-player duplicate protection is backed by a PostgreSQL partial unique index, and there is a genuine simultaneous-registration test.
- Auth and QR tokens use 32 random bytes; staff/session tokens are stored as hashes.
- One-time login-token claiming uses an atomic conditional update.
- Admin routes are consistently guarded; public ticket responses omit parent contacts.
- PINs are salted/hashed and compared with `timingSafeEqual`; wrong-attempt limiting exists, even though its deployment/resource policy needs work.
- Prisma parameterisation is used; no unsafe raw SQL query construction was found in application paths.
- Player/event text is escaped in selector sheets, and React text rendering is used for the ordinary UI. The unsafe URL attributes are a specific exception, not a claim that all rendering is unsafe.
- Fresh draft creation uses a transaction and does not save a generator failure. Apply that same discipline to composite regeneration and publishing.
- Dependency-injected provider interfaces, a pure generator, and an independent checker are useful foundations for the missing regression tests.
- The test setup explicitly refuses a non-test database. Keep this safeguard for all new probes and CI.

## Recommended remediation order

1. **Deployment safety and payments:** R01–R03, R12, R28. Fail closed; fix settled-payment validation and atomic idempotency before accepting any real payment.
2. **Usable basic flow:** R04–R05, R13–R15, R16, R22. Browser login, open event, register/pay, receive a usable QR/calendar, and recover safely.
3. **Trial-day correctness:** R06–R10, R20–R23. Strong checker first, then feasible scheduling/search, then frozen-prefix regeneration and reviewed print revisions.
4. **Privacy and auditability:** R11, R17–R19, R24–R26. Complete retention, real delivery/retry/provenance, review lifecycle, input/policy validation, and truthful errors.
5. **Release discipline and simplification:** R27, R29–R31, then the ranked reuse/deletion list. Add CI/runbook, verify dependencies and packaging, exercise browser/device acceptance, and measure before further performance work.

The next implementation pass should turn each confirmed failure into a regression test for the intended behaviour before changing it. Keep application changes separate from speculative refactors, and do not mark the spec complete until the end-to-end acceptance journeys pass.
