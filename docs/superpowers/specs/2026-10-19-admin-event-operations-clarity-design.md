# Admin Event Operations Clarity — Design

**Date:** 2026-10-19
**Status:** Draft for review

## Goal and audience

Help committee members and trial-day volunteers scan event status, PIN configuration, check-in state, and court colors without confusing routine setup with actions that close access or revoke sessions. Keep the existing Event operations route and Chisholm’s flat, practical visual system.

## Product truth

- `OPEN` registration can be closed to new families; the current lifecycle offers no reopen action after `CLOSED`.
- Closing check-in stamps `checkInClosedAt` and revokes active volunteer sessions; there is no reopen operation.
- Removing a check-in PIN revokes current volunteer sessions. A new PIN can be configured afterward.
- The event operations page is used by committee members during setup and on trial day. Admin check-in and day-of registration shortcuts must remain easy to find.
- Court team colors always have written names; color alone is not a team identifier.

## Decisions

### Feedback stays beside its control

- Show invalid-PIN feedback immediately beside the PIN field/action, rather than after the court-color section.
- Keep PIN save/rotate success or failure beside the PIN controls.
- Keep event-status and check-in-close feedback near their respective controls. Do not reuse one generic message location for unrelated operations.
- Preserve the page’s loading/error states and existing disabled-while-busy behavior.

### Separate lifecycle actions from routine setup

- Keep event status and its close action in a clearly named event-registration section.
- Explain before the action that closing registration prevents new registrations and cannot be reopened through this workflow. Retain a confirmation step.
- Keep volunteer PIN and check-in controls in their own section. Explain that closing check-in revokes volunteer sessions and cannot be reopened, and that removing a PIN revokes current sessions but a new PIN can be set later.
- Give closure/removal controls lower visual emphasis than routine save actions while retaining the current confirmation dialogs. Avoid a visually alarming red card or a new modal pattern.
- Preserve the current conditional Admin check-in and day-of registration quick links near the top of Event operations.

### Court colors and workflow navigation

- Lay out court-color fieldsets in two columns at desktop widths and one column on narrow screens. Each court remains a distinct, labeled save unit.
- Increase the outline contrast for white/light swatches; retain the written color name beside every swatch.
- Keep the existing Event, Planning, and Trial day workflow groups, active-page markers, special trial-day routes, and mobile Event tools toggle. At widths of 56rem or more, lay the three groups out in three columns, with a compact two-column link grid within each group and its heading spanning both columns. At intermediate widths, use two group columns. Keep the existing single-column collapsible mobile layout at 38rem and below. Do not hide desktop links; shorten a visible label only where its group heading makes the meaning unambiguous.

## Acceptance criteria

- An invalid PIN and PIN save failure are announced adjacent to the PIN controls; a PIN success message is also adjacent.
- Event-close and check-in-close messages appear beside their own actions, not at the bottom of the whole operations page.
- The UI states the consequences and reversibility of closing registration, closing check-in, and removing a PIN accurately; backend lifecycle semantics do not change.
- Existing Admin check-in and day-of shortcuts remain near the top and appear only under their current eligibility conditions.
- Four-to-six court assignments form a predictable two-column desktop grid and a single-column mobile layout without horizontal overflow.
- White/light swatches remain distinguishable and all team colors retain readable names.
- Desktop workflow links scan in three stable columns without an ad hoc wrapped row; intermediate/mobile layouts remain usable, and current-page and mobile-toggle behavior remain accessible.
- Tests cover PIN error placement, independent operation feedback, conditional actions, and nav/court layout states.

## Non-goals

- Changing event lifecycle rules, PIN security, volunteer permissions, payment behavior, or court-color persistence.
- Replacing the site navigation with a new shell or adding cards, shadows, gradients, or new brand assets.
- Changing event operation API contracts or introducing real Admin/test mutations during review.
