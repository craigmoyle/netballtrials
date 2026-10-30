# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript and Vite for the web app; Fastify and TypeScript for the API; PostgreSQL with Prisma for persistence. Chosen by the user to match the sibling `netball-scoring` project. The operating entity is Chisholm Netball Region Inc (ABN 41 649 079 458). Hosting is planned for Bluehost. Email uses the Gmail API with OAuth from `chisholmnetball@gmail.com`.

## Users

- **Parents and guardians** register a player and pay, usually on a phone. Many are doing this for the first time each year and are not technical. Some may have accessibility needs even when the child does not.
- **Committee members** (Chisholm Netball Region committee, including the State Titles Officer) run everything: creating events, managing member-association contacts, reviewing flagged registrations, checking players in on the day, generating rounds, printing sheets, and communicating with associations and registrants. They manage reusable email templates and scheduled sends. Check-in volunteers are drawn from the committee and use a separate event PIN so their access is limited to check-in.
- **Coaches and selectors** pick the teams on trial day. They use printed landscape sheets only and have no screens of their own in this release.

## Product Purpose

Run Chisholm Netball Region's annual State Titles trials, usually held in September, from registration and online payment through QR check-in with bib numbers, constrained round generation, and printable selector sheets. The existing public trials tool does not give the club enough control over position assignments and court rotations. Success is a trial that runs on time with every court full at 14 players and fewer complaints from parents; the fewer the better.

## Positioning

The club controls how rounds are built. Players choose up to three ranked positions, the committee sets minimum games per rank, every player is seen on every court, and when the requirements cannot all be met the app explains the shortfall and asks for adjusted settings instead of silently relaxing a rule. A generic trials platform cannot offer that level of control for one club's selection process.

## Operating Context

- One event per age group or division (15/U, 17/U, Open, All Abilities, and occasional boys trials), one date per event, typically 60 to 100 players on 4 to 6 courts.
- Players register through an event link, confirm the parent or guardian email, pay by card through the club's existing Stripe account, and receive a confirmation with a QR code. A registration is complete only after both email verification and confirmed payment.
- On the day, volunteers scan QR codes on phones or tablets, often outdoors, assign bib numbers, and close check-in when the roster is final. Rounds are generated only from players who arrived.
- Selectors work from printed landscape sheets showing round, court, teams, positions, player Numbers and names, with writable space for selection notes.
- Eligibility and age rules come from the club's published selection policy (https://chisholmnetball.com/selection-policy/, reviewed 27 August 2025); age is measured at 31 December of the competition year.

## Capabilities and Constraints

- Seven positions: GS, GA, WA, C, WD, GD, GK. Each court runs a full 7-a-side game of 14 players every round.
- Players enter up to three distinct ranked position choices; the third is optional. An opt-in lets a player be used outside their choices, and those assignments are marked on selector sheets. Spread extra-position assignments fairly and vary opponents where feasible so the same players are not repeatedly overused to fill gaps. Player Statistics report each player's unique opponents and repeat meetings, plus the total number of repeated player-pair meetings in the schedule.
- Every active player should play on every court. The planner enforces minimum games for each chosen rank; when position shortages require extra-position assignments, it balances appearances and explains any shortfall rather than silently relaxing requirements.
- A person submitting a player's details confirms they are authorised to do so and, for a player under 18, have permission from the parent, legal guardian or responsible person. Email verification confirms control of the inbox, not guardianship; the authority confirmation remains required. Duplicate submissions are matched by event, exact player name and date of birth without creating a permanent player identity link; siblings can share a parent email.
- Parents and guardians use a passwordless portal. Single-use email links expire after 15 minutes and require an explicit Continue step. A verified email can manage all registrations linked to it, including siblings. While registration is open, a parent can update contact details, player name and position choices, continue pending Checkout, or withdraw with a clear no-refund notice. DOB and association corrections remain Admin-reviewed; payment status is never parent-editable. Email changes take effect only after verifying the new address, update the linked registrations together, notify the old verified address and leave a reviewable audit entry. For a mistyped, unverified address, an Admin can first confirm the correction with the family; the corrected address must still be verified before it grants access or Checkout.
- Admins can review incomplete submissions by email-confirmation and payment stage. Follow-up is available only for verified email addresses. Incomplete submissions are anonymized after 30 days; completed application data follows the four-calendar-year retention period.
- Admins can review a player's possible progression across annual trials through a purpose-built history search using exact player name and date of birth. Results are event-scoped registrations, not a permanent player profile; the interface warns that exact matches are candidates and must be manually verified before comparing. The feature does not save links or merge records. The history shows only trial-relevant data: event/season, division, association, position choices, attendance, event-specific Number, game/court/position appearances and opponent-variety measures. It excludes parent contacts, payment identifiers and safeguarding case notes. Results are available only while the underlying registrations remain within the four-year application retention period.
- Each member association has a primary contact name and email for committee communications. These contact details are restricted to Admins and are not shown to parents or volunteers.
- A Communications workspace sends email to selected association contacts or to parents/guardians of participants in an event. Participant recipients are filterable by relevant event, association, registration/payment status, check-in status and position choices; an Admin can include or exclude individual recipients. Preview the final recipient count and list before sending or scheduling. Participant rows show the player's Number when assigned, alongside their name.
- Admins manage reusable email templates and schedule one-off communications. Scheduled messages use the Australia/Melbourne timezone, can be reviewed and cancelled before sending, and have delivery status and safe retry history. Scheduled sends revalidate recipient eligibility at send time.
- Send the automatic event reminder approximately 24 hours before the trial.
- Admins can attach a selection-policy document (PDF) to an event so families can open or download it from registration and event communications; do not require an Admin to hand-type a non-clickable policy link.
- No refunds. Admins can make validated manual changes to an unfrozen round and rebuild future rounds; frozen rounds cannot be edited. Selector ratings and post-trial team selection are out of scope.
- Internet access is assumed at check-in; there is no offline mode.
- Card data is never stored; Stripe handles it. QR codes contain only a random token.
- Completed event registration and communication personal data held by the application is deleted or anonymized four calendar years after the event. Incomplete submissions are anonymized after 30 days. Financial records required for the incorporated association are maintained separately for at least seven years; the app's retention jobs are not the accounting record. Gmail Sent copies are outside these retention periods.
- Member-association primary contact details remain on file until an Admin changes or clears them; deactivating an association does not automatically erase its contact details.
- Trial history supports operational continuity and player progression across age groups; it is not a selection outcome or ranking system.
- Open decisions: hosting platform and final selector-sheet fields and layout.

## Brand Commitments

The Chisholm Netball name and logo appear on public registration, emails and selector sheets. The user asked the app to take visual cues from the club's existing branding: its blackletter wordmark and deep plum accent, kept cleaner and easier to use than the current club website. The club's Roboto text is a theme default, not a commitment.

## Evidence on Hand

- The club's public site and published selection policy.
- The club's current logo, available only as a small 171 by 57 pixel image; a vector or high-resolution original has not been supplied.
- No testimonials, customer quotes, or usage numbers exist and none should be invented.

## Product Principles

- Never silently relax a rule. When requirements cannot be met, say exactly where the gap is and what to adjust.
- Fewer complaints is the measure. Parents should always know what happened to their registration and payment, and what to do next.
- Give the committee control and make results explainable, including why a player was placed where they were.
- Collect only the personal information of children and parents that the trial needs, and never reveal one family's registration to another.
- Work on a busy trial day: fast, glanceable, and forgiving when a volunteer makes a mistake.

## Accessibility & Inclusion

Aim for accessibility at all times, targeting WCAG 2.2 AA across the registration flow, ticket page, staff screens, scanner, emails and printed sheets. The child may not need it, but a parent might.
