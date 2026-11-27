# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript and Vite for the web app; Fastify and TypeScript for the API; PostgreSQL with Prisma for persistence. Chosen by the user to match the sibling `netball-scoring` project. The operating entity is Chisholm Netball Region Inc (ABN 41 649 079 458).

Hosted TEST runs at `https://trials-test.statsball.net` with its own `_test` database. The production destination is `https://trials.chisholmnetball.com` on the current VPS. TEST is expected to remain for the short-term stabilisation period, then be retired after a completed production trial and an explicit committee/operator decision that the system is settled. Local and CI fake integrations remain useful after hosted TEST is retired.

Email uses the Gmail API with OAuth. TEST uses the approved test mailbox; production uses `chisholmnetball@gmail.com` as sender and reply-to. TEST always displays a clear TEST indication and uses Stripe test credentials. Production and TEST data, sessions, payment references and tickets must never be copied between environments. At production cutover, carry configuration and an explicitly reviewed Admin roster only, not TEST registrations or operational history.

## Users

- **Parents and guardians** register a player and pay, usually on a phone. Many do this for the first time each year and are not technical. Some may have accessibility needs even when the child does not.
- **Committee Admins** are a small, trusted subset of the Chisholm Netball Region committee. They have one full Admin role: all Admins can manage events, associations, registrations, policy documents, check-in, plans, communications, settings and review items. There are no separate registrar, planner, communications or super-Admin permissions in scope.
- **Event-day check-in helpers** are committee members given limited, temporary access by event PIN. They may check players in during the Melbourne event date but cannot access parent contacts, payments, planning, history, communications or settings. Public volunteer access is never a substitute for an Admin account.
- **Coaches and selectors** work from printed landscape sheets only. They do not use an application account. Paper ratings and notes are disposed of under club practice and are not copied, uploaded or retained in the application.

## Product Purpose

Run Chisholm Netball Region's annual State Titles trials, usually held in September, from strict registration and online payment through QR check-in, constrained round generation and printable selector sheets.

Success is a trial that runs on time, with every court full at 14 players where constraints permit, clear explanations when they do not, and fewer complaints from parents. The product is Chisholm-specific; there is no current goal to sell or configure it for other organisations.

## Positioning

The club controls how rounds are built. Players choose up to three ranked positions, the committee sets minimum games for each rank, every active player should be seen on every court, and the application explains any unsatisfied requirement instead of relaxing it silently.

This specificity is the product's advantage over a generic trials platform: one club's selection policy, roles, communications, timing, payment rules and paper selector workflow are implemented as a coherent operating system.

## Operating Context

- One event per age group or division, including 15/U, 17/U, Open, All Abilities and occasional boys trials; one date per event.
- Typical scale: 60 to 100 players, 4 to 6 courts, a handful of Admins and event-day helpers.
- Event `startTime` means the published arrival/start time and controls automatic registration deadlines and reminders. `gameStartTime` controls planner and round timing only.
- Events use Australia/Melbourne time. Competition age is measured at 31 December of the event's explicit `competitionYear`.
- Eligibility rules come from the club's published selection policy: <https://chisholmnetball.com/selection-policy/>. The policy reviewed on 27 August 2025 is current evidence, not permission to invent later changes.
- Public registration uses the exact event link. Email confirms inbox control; the submitter separately confirms authority for the child's details.
- Stripe handles all card data and payment truth. The application never accepts a payment-status bypass.
- Internet access is assumed at check-in. There is no offline mode.
- Public registration and day-of Admin additions are separate workflows. A closed event never needs public registration reopened merely to add a late player.

## Environments and Operational Boundary

- Hosted TEST and production are isolated by domain, database, credentials and mailbox/provider mode.
- Production uses `trials.chisholmnetball.com`; TEST remains at `trials-test.statsball.net` only while hosted TEST is required.
- TEST data is never production data and may not be copied to production except for reviewed configuration: association setup, bib colors, templates, current event-independent settings and explicitly confirmed Admins.
- Production Admins are reviewed individually and use fresh one-time sign-in links. TEST Admin membership alone does not grant production access.
- Production promotion does not require extra approval gates or multiple organisation roles. It remains an operator-controlled, reviewed-commit deployment with validated rollback steps.
- Emergency recovery restores the mailbox, Admin account or infrastructure through provider/committee controls. The application must not contain a shared password, hidden backdoor, bypass link or production reset function.

## Capabilities and Constraints

### Event lifecycle and registration deadline

Each event starts as `DRAFT`. Opening an event is a deliberate Admin action. A current-year event clone must not inherit OPEN/CLOSED state, dates, registrations, plans, check-in data, sent messages, PINs or payment sessions.

Every event has a required `registrationClosesAt` in Australia/Melbourne time. The Admin confirms it before opening registration; the suggested default is 24 hours before `startTime`. The deadline is never allowed after `startTime`.

When `registrationClosesAt` arrives, public registration closes automatically. An existing accepted registration continues through verification and payment within its own valid deadlines. Closure blocks only new public submissions.

The following states remain conceptually separate even if the UI presents them together operationally:

- Registration acceptance: open or closed by the deadline/manual Admin action.
- Event status: DRAFT, OPEN or CLOSED.
- Check-in: open or closed by an event-day Admin action.
- Plan state: draft, published, and frozen through a completed round.

An Admin may move the deadline earlier or later while preserving the `<= startTime` rule. If registration has closed and the Admin wants to accept more public applications, the Admin must set a future deadline and explicitly confirm reopening. On event day, use the Admin late-add workflow rather than reopening public registration.

The public event list shows no DRAFT event. OPEN events accept registration while their deadline permits. CLOSED events can show their public details and policy without allowing a new public registration.

### Eligibility and selection policy

The event stores its `competitionYear`, age limits, policy reference and an effective policy identifier/version. Age is calculated at 31 December of that explicit competition year. Minimum and maximum ages are inclusive.

Eligibility is strict and absolute:

- A player who is outside the event's permitted age range is rejected before a registration record is created, before email verification, before Stripe Checkout and before a hold is established.
- The parent-facing error says why the player is ineligible, including the competition year and applicable age range.
- Admin-assisted entry follows the same rule.
- Admins may not override age eligibility. A different policy requires correcting the event configuration and, where necessary, closing the event and handling any affected payment through the explicit payment-review path.
- An event's effective policy snapshot and eligibility rules remain stable for its existing registrations. A policy change is not applied silently to an open historical event.

A submission without valid, complete identity details is rejected. The Admin may not create an estimated DOB or placeholder player identity.

### Registration state and authority

A registration is complete only after:

1. A person authorised to submit the details confirms their authority.
2. The guardian email is verified.
3. Stripe confirms the expected payment amount and currency.

Email verification proves control of the inbox, not guardianship. The separate authority confirmation remains required. A second address never gains access automatically because it appears to belong to another guardian; disputes are handled by an Admin and recorded.

Use one explicit registration lifecycle. The principal states and transitions are:

| State | Meaning | Principal next actions |
| --- | --- | --- |
| Pending email | Details accepted; guardian email not verified | Verify, expire, Admin-correct email, anonymise |
| Pending payment | Email verified; Stripe payment not confirmed | Continue/resend Checkout, pay, expire, withdraw |
| Paid | Stripe confirms the exact amount/currency | Check in, withdraw/remove, enter review if a later correction invalidates the record |
| Expired / Failed | Accepted attempt did not complete | Retry with valid Checkout within policy, withdraw, or anonymise |
| Withdrawn | No longer active for the event | Keep history and payment evidence; event-local duplicate/withdrawal reason is recorded |
| Checked in | Paid and physically admitted | Appear in plan, undo check-in where operationally allowed, remove as an early leaver |
| Duplicate | A separate submission identified as the same event/player | Link event-locally to retained registration; keep both records and payment evidence; exclude duplicate from check-in/planning |
| Anonymised | Retention cutoff reached | No public/parent/Admin personal use; retained non-personal aggregates only |

Duplicate matching uses the event plus exact player name and DOB. A duplicate is not merged into a permanent identity. The retained record remains authoritative for operations, and the duplicate record is marked with an event-local reference and reason. A registration or payment is never resurrected automatically from a late Stripe event; any exceptional reinstatement is an explicit, audited Admin action.

### Parent and guardian portal

- Passwordless sign-in links are single-use, expire after 15 minutes and require an explicit Continue step.
- A verified email may manage all registrations linked to it, including siblings.
- Parents may update permitted contact/player details, position choices and pending Checkout before closure/roster lock, and may withdraw with a clear no-refund warning.
- DOB and association corrections remain Admin-reviewed because they can affect identity, eligibility and planning.
- Payment status is never parent-editable.
- Email changes require verification at the new address, update linked registrations together, notify the old address, invalidate unsuitable old links, preserve reviewable audit history and rebind pending Checkout/confirmation work where safe.
- Logout affects only that session. Admin removal or a security response may revoke all relevant sessions.

### Payments

- Card data is never stored; Stripe handles it.
- Stripe is the payment source of truth. No Admin workflow marks a registration paid without confirmed Stripe evidence.
- A registration is complete only when expected Stripe amount and currency are confirmed. A mismatch creates a payment review item for manual resolution/refund handling.
- There are no automatic refunds. Removing or withdrawing a paid player does not call Stripe and does not promise a refund; the confirmation copy tells the guardian to contact the club about the payment.
- After a valid email verification, the application automatically creates or reuses Stripe Checkout and durably sends the secure continuation link. It must not send a known-expired or unusable Checkout link.
- Repeated Checkout links remain governed by the normal hold and expiry rules. A new Checkout may be created after a prior session is confirmed expired, without reopening public registration.
- An ambiguous Stripe outcome blocks a second payment attempt until the Admin checks the provider outcome.
- If valid Checkout cannot be created at the one-hour reminder, send the parent and `chisholmnetball@gmail.com` a clear warning that payment has not been received and the registration is incomplete; provide no dead link and tell both parties to contact the committee immediately.

### Admin late additions and removals

Late additions are Admin-only and do not reopen public registration. The Admin takes complete details from the family on the day and follows the same trust/payment sequence:

1. Validate complete identity details and strict age eligibility.
2. Confirm submitter/guardian authority.
3. Send and await email verification; allow resend under the normal rate limit.
4. Automatically create/reuse Stripe Checkout and send the secure link.
5. Receive confirmed Stripe payment.
6. Admin checks the player in, assigns the next Number and makes them planner-eligible.

A pending day-of addition stays in an Admin queue showing whether email verification or payment is missing. It cannot be checked in or added to a plan. For a verified email, the Admin may show a secure same-origin Checkout QR/link on screen after the email is sent, but must never display card data or bypass verification.

A paid late arrival may be checked in through the Admin workflow even after normal check-in is closed. Public registration and volunteer PIN access remain closed.

A player removed on the day retains their registration, payment evidence and historical rounds. A paid removal does not refund payment. The Admin records a reason (`Duplicate`, `Unable to attend`, `Late withdrawal`, `Ineligible correction`, `Did not arrive` or `Other` with a note), removes the player from future planning, and preserves completed/frozen assignments.

If removing or adding a player makes the current plan invalid, the Admin sees the exact shortfall. A late addition or removal regenerates only future rounds and never silently changes completed rounds.

### Check-in and final roster

- Check-in helpers use a six-to-eight-digit event PIN, available only during the Melbourne event date while check-in is open.
- Admin check-in does not need the event PIN but has the same event-day restriction.
- QR codes contain only a random token; identifying data is retrieved server-side.
- A paid player is assigned an event-specific Number on check-in. A volunteer never sees parent contacts or payment identifiers.
- Check-in can be closed explicitly by an Admin. Reopening it is an explicit, confirmed operational action.
- Public/PIN check-in closure does not disable Admin late-add completion.
- Closing check-in for the first time creates an immutable initial roster snapshot for the event. Later Admin additions/removals create subsequent revisions and preserve the earlier snapshot.

### Planner and selector sheets

- Seven positions: GS, GA, WA, C, WD, GD, GK. A full court is 14 players per round.
- Players enter up to three distinct ranked position choices; the third is optional.
- Extra-position opt-in is explicit and assignments outside chosen positions are labelled.
- Every active player should be seen on every court. The planner enforces minimum games for each chosen rank, balances extra-position appearances and varies opponents where feasible.
- Do not silently relax a constraint. Return the exact shortage, surplus, missing court/position or time-window problem and ask the Admin to adjust settings or accept only an explicit warning where the policy allows.
- Completed rounds are frozen. Manual changes apply only to unfrozen rounds. An Admin may complete/freeze the next round, and regenerate future rounds after a late arrival or early leaver.
- Player statistics show unique opponents, repeat meetings and the schedule's repeated-pair total.
- The on-screen schedule, statistics and player-reference views support operational decisions; printed selector sheets are the final selection workspace.
- Selector sheets are A4 landscape and show round/court/event header, Team A/Team B written color names, position, player Number/name, ranked choices, rating and notes/feedback. Blank game sheets provide the same writable selection fields.
- Export formats are print/PDF only. Do not create editable selector-sheet exports, CSV selection records, digital ratings or persisted post-trial selections.

### Communications and reminders

Communications have a single Admin workspace for event participants and association contacts. Admins can preview every selected registration/recipient, with a distinct-email count and visible household grouping, before sending or scheduling. Scheduled sends revalidate eligibility at dispatch; immediate sends must use the reviewed snapshot and reject a changed recipient set.

Reusable templates and scheduled messages remain editable only while scheduled. Delivery state and safe retry history are visible in Communications.

Automatic reminders use this schedule in relation to `startTime`:

| Reminder | Audience | Trigger | Conditions and failure behavior |
| --- | --- | --- | --- |
| Event details | Paid registrations | Approximately 24 hours before | Send once per event/household. Recheck payment before send. Paid status is enough; check-in is not required. |
| Payment completion 1 | Verified, unpaid, non-withdrawn registrations with a valid/recoverable Checkout | Approximately 24 hours before | System-controlled copy says registration is incomplete until payment. Group siblings by verified email. |
| Payment completion 2 | Same audience, if still unpaid | Approximately one hour before | Suppressed if paid. If valid Checkout cannot be created, send a parent warning and an Admin warning to `chisholmnetball@gmail.com` with no dead link. |

Scheduler timing is window-based because the job runs about every 15 minutes. Each stage has its own idempotency key and sends only once. One Admin manual payment reminder is permitted per registration/state; a changed Checkout or unrelated edit does not reset it.

Reminder copy keeps system-controlled statements such as “registration is incomplete until payment is received”. Event details, dates and venue may be templated. A guardian warning tells them no payment has been received and to contact the club. The Admin warning contains the event, player, registration ID and safe error category, but not Stripe credentials or card data.

An unresolved, failed or ambiguous delivery appears in the Needs attention/Communications workflow. A delivery with an ambiguous provider outcome is never automatically retried; an Admin must confirm that a duplicate message is an accepted risk.

Each member association has a primary contact name and email. These details are Admin-only and remain until an Admin changes or clears them. Deactivating an association does not erase its contact. For a scheduled association campaign, ineligible contacts are excluded at send time and the remaining valid recipients continue when at least one is eligible.

### Review, audit and exception handling

Admins have one combined Needs attention entry point for:

- Orphaned/ambiguous Stripe outcomes
- Incomplete payment problems
- Verification or email failures
- Failed scheduled messages
- Ambiguous delivery outcomes
- Incomplete late additions
- Registration duplicates/corrections needing review

An item stays visible until an Admin resolves or acknowledges it. Resolution records actor, time, short reason, current attempt/state and the action taken. No automatic later job silently clears a real provider problem.

The following state changes require an attributable audit entry with actor, time, before/after state and short reason where relevant:

- Event open/close/reopen and registration deadline changes
- Late addition, removal/withdrawal and duplicate marking
- DOB or association correction, including who confirmed it and how
- Unverified-email correction
- Checkout/payment review or reinstatement
- Round completion/freeze, publication, manual edit and suffix regeneration
- Manual communication send or ambiguous-outcome retry
- Admin roster invite/removal

Read-only searches and page viewing do not need audit records. Export actions record actor, event, time and export type; the export itself is not retained in the application.

### Player history and data privacy

Player history is an Admin-only exact-name-and-DOB search for possible progression across retained event registrations. It never creates a permanent player profile, saves identity links or merges records. Results are candidates that the Admin must manually verify.

History shows only event/season, division, association, position choices, attendance, event-specific Number, round/court/team/position appearances, and opponent-variety measures. It excludes parent contacts, payment identifiers and safeguarding notes.

One family's personal data is never shown to another family. Association contacts are Admin-only. QR/ticket data contains only a random bearer token, and public ticket views stop revealing identifying details after their operational period and retention cutoff.

### Retention and paper records

- Incomplete registrations are anonymised after 30 days.
- Completed event registration, communication, plan and audit personal data is deleted or anonymised four calendar years after the event.
- Association contacts remain until an Admin changes or clears them.
- Financial books are maintained separately for at least seven years; the application is not the accounting record.
- Gmail Sent copies follow mailbox/provider retention and are outside the application's four-year period.
- Backups require their own encrypted expiry/restore policy and are not considered application retention overrides.
- Selector sheets are paper output. Completed ratings and notes are handled and disposed of by the committee; no scans, photos or digital rating records are imported into the app.

## Release and Operational Targets

No additional approval gate is required for production release. The following are engineering expectations rather than organisational roles:

- Support at least 100 players and 6 courts.
- The planner benchmark must remain bounded; current acceptance target is under 15 seconds for the representative 100-player/6-court case.
- Normal local API requests should complete within about two seconds outside deliberate provider calls or long-running generation jobs.
- QR or manual check-in feedback should normally complete within five seconds on the expected network and device.
- Reminder and retention jobs complete or report an explicit failure; silent success is not acceptable.
- Tests, build and dependency audit pass before a deploy.
- Admin, parent and volunteer browser flows are checked after material user-flow changes.
- Payment TEST and mail TEST work before a provider-related release.
- Printable selector output remains readable and correctly oriented.

## Brand Commitments

The Chisholm Netball name and logo appear on public registration, emails and selector sheets. Preserve the club's existing blackletter wordmark and deep-plum visual identity as recorded in `DESIGN.md`, but keep the interface clearer and more practical than the public club site. The club's Roboto text is a theme default, not a commitment.

TEST screens and emails always say they are TEST. Production screens never carry TEST language once launched.

## Evidence on Hand

- Chisholm Netball's public site and published selection policy.
- The club's current logo, available only as a small 171 by 57 pixel image; a vector or high-resolution original has not been supplied.
- Hosted TEST on the shared VPS and local/CI fake integrations demonstrate the current implementation boundaries, but are not proof of future live-production behavior.
- No testimonials, customer quotes or usage numbers exist and none should be invented.

## Product Principles

- Never silently relax a rule. Explain the exact gap and the safe adjustment.
- Strict eligibility and confirmed payment come before roster participation; convenience never becomes a bypass.
- Parent and operator state must be clear: what happened, what is still missing and what to do next.
- One Admin role is sufficient, but every consequential Admin action is attributable.
- Collect and expose only the personal data the trial needs, and never reveal one family's record to another.
- Work on a busy trial day: fast, glanceable and forgiving without rewriting completed history.

## Accessibility & Inclusion

Target WCAG 2.2 AA across public registration, parent management, ticket pages, Admin screens, scanner use, emails and printed sheets. Parents may have accessibility needs even when the player does not. Keyboard access, readable status text, non-color-only state, camera/manual fallback and printable black-and-white clarity are product requirements, not optional polish.
