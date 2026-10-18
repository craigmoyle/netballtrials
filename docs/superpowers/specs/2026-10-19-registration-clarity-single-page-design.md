# Public Registration Clarity — Single-Page Design

**Date:** 2026-10-19
**Status:** Draft for review

## Goal and audience

Help parents and guardians, usually on a phone and often registering for the first time that year, understand eligibility, enter a player once, and know what happens after submission. Retain the current single-page registration flow and its section links.

## Product truth

- Age is measured on 31 December of the competition year. The configured event age bounds are `minAge` and `maxAge`.
- Eligibility also requires permanent participation at a Chisholm Region member association and at least six association games in the published date range.
- Public registration may continue to an in-page Fake-mode simulation or to an emailed secure Checkout link, depending on payment configuration. Admin-assisted registration sends the payment link to the parent.
- Card data is handled by Stripe in the future test flow; the local Fake simulation collects no card details.
- Keep the Chisholm blue/plum identity, one system sans-serif voice, and the existing product language. Use **Number** for assigned identifiers; do not use “bib” for the player identifier.

## Decisions

### One page, clearer orientation

- Keep all four registration sections on the same route, in the same page flow: Player details, Parent or guardian details, Position preferences, and Eligibility confirmation.
- Keep the current anchor navigation. Add a lightweight current-section indicator: update `aria-current="location"` on the matching section link as that section enters view. It remains navigation, not a wizard or gated step sequence.
- Tighten non-control vertical spacing and shorten duplicated explanatory copy where possible. Keep all fields visible in the page, preserve at least 2.75rem control targets, and keep the privacy and eligibility facts findable before submission.
- Keep public prose around the design system's 65–75ch measure. Split the long privacy note so no rendered line exceeds the detector's 80-character target at the assessed desktop/mobile widths.
- Do not persist child or parent details to localStorage, sessionStorage, or another browser store. If entered details would be lost, warn before internal navigation and browser unload; keep the values in memory while the page stays open.

### Eligibility and policy copy

- Show the event’s exact age range and measurement date beside the event summary: “Age range: {minAge}–{maxAge} years old as at 31 December {competitionYear}.” Render the values from the loaded event, not hard-coded copy.
- Repeat the age rule beside the eligibility checkbox with the existing permanent-player and six-game criteria. Do not claim the adjacent text is the full eligibility criteria unless it includes all the required rules.
- Keep the selection-policy link. Because it opens a new tab, say so in its visible or accessible label.
- Keep the privacy statement’s facts: use of parent/player details, that parent contacts are not shown to volunteers, and the 12-month deletion/anonymization period. Shorten the prose without changing those facts.

### Position choices

- A position can appear in only one rank. Disable an option in any rank when it is selected in another rank; keep the current value selectable in its own control.
- Do not silently clear a parent’s later-ranked choice when they change an earlier rank. Explain that a lower-ranked choice must be cleared before moving it to a higher rank.
- Keep server-side distinct-position validation as the trust-boundary guard.

### Submission and next-step copy

- Public form action: **Submit registration**. This accurately covers both the Fake in-page simulation and the email continuation path.
- Admin-assisted action: **Send payment link**. Do not imply the volunteer is entering payment details.
- If the response contains a Fake simulation token, show the existing card-free test step. If it does not, keep the neutral receipt and tell the parent to check email for the secure Checkout link.
- When the form is replaced by the Fake simulation, move keyboard focus to its heading. Announce completion and errors using the existing status/alert semantics.

## Acceptance criteria

- The age bound and 31 December calculation match the event data and server rule on both the event summary and eligibility confirmation.
- A parent can follow the four sections on one page; the current section is discernible through `aria-current="location"` and the anchors remain usable by keyboard and screen reader.
- No two rank controls can end in a duplicate position through normal interaction, and the UI does not silently erase a chosen preference.
- The public action copy does not promise an immediate payment form when the configured flow sends email; Admin-assisted copy identifies the parent email handoff.
- Fake mode remains card-free, no-token/email mode remains neutral, and Admin-assisted registration remains email-based.
- The simulator transition, errors, and success are keyboard- and screen-reader perceivable; no personal information is stored in browser persistence.
- Mobile layout remains free of horizontal overflow and keeps the existing minimum control size.

## Non-goals

- Changing eligibility rules, payment authority, registration response privacy, or duplicate matching.
- Introducing a multi-page wizard, browser draft persistence, a new payment provider, card fields, or live payment behavior.
- Rebranding the public registration page or adding external assets.
