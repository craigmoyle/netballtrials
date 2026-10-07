# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript and Vite for the web app; Fastify and TypeScript for the API; PostgreSQL with Prisma for persistence. Chosen by the user to match the sibling `netball-scoring` project. Hosting platform and email provider are deliberately undecided.

## Users

- **Parents and guardians** register a player and pay, usually on a phone. Many are doing this for the first time each year and are not technical. Some may have accessibility needs even when the child does not.
- **Committee members** (Chisholm Netball Region committee, including the State Titles Officer) run everything: creating events, reviewing flagged registrations, checking players in on the day, generating rounds, printing sheets, and messaging registrants. Check-in volunteers are drawn from the committee and use a separate event PIN so their access is limited to check-in.
- **Coaches and selectors** pick the teams on trial day. They use printed landscape sheets only and have no screens of their own in this release.

## Product Purpose

Run Chisholm Netball Region's annual State Titles trials, usually held in September, from registration and online payment through QR check-in with bib numbers, constrained round generation, and printable selector sheets. The existing public trials tool does not give the club enough control over position assignments and court rotations. Success is a trial that runs on time with every court full at 14 players and fewer complaints from parents; the fewer the better.

## Positioning

The club controls how rounds are built. Players choose up to three ranked positions, the committee sets minimum games per rank, every player is seen on every court, and when the requirements cannot all be met the app explains the shortfall and asks for adjusted settings instead of silently relaxing a rule. A generic trials platform cannot offer that level of control for one club's selection process.

## Operating Context

- One event per age group or division (15/U, 17/U, Open, All Abilities, and occasional boys trials), one date per event, typically 60 to 100 players on 4 to 6 courts.
- Players register through an event link, pay by card through the club's existing Stripe account, and receive a confirmation with a QR code.
- On the day, volunteers scan QR codes on phones or tablets, often outdoors, assign bib numbers, and close check-in when the roster is final. Rounds are generated only from players who arrived.
- Selectors work from printed landscape sheets showing round, court, teams, positions, bib numbers and names.
- Eligibility and age rules come from the club's published selection policy (https://chisholmnetball.com/selection-policy/, reviewed 27 August 2025); age is measured at 31 December of the competition year.

## Capabilities and Constraints

- Seven positions: GS, GA, WA, C, WD, GD, GK. Each court runs a full 7-a-side game of 14 players every round.
- Third position choice is optional per player; an opt-in lets a player be used in positions they did not choose, and those games are marked on the sheets.
- Duplicate registrations are detected by name and date of birth within an event; siblings can share a parent email.
- No refunds and no manual editing of generated schedules in the first release. Selector ratings and post-trial team selection are out of scope.
- Internet access is assumed at check-in; there is no offline mode.
- Card data is never stored; Stripe handles it. QR codes contain only a random token.
- Personal data is deleted or anonymized 12 months after the event.
- Open decisions: hosting platform, email provider, final selector-sheet fields and layout.

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
