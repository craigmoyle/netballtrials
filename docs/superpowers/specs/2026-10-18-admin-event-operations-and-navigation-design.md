# Admin Event Operations and Navigation Design

**Date:** 2026-10-18  
**Status:** Draft for review

## Goal

Prevent event-setting edits from being lost, make trial-day operations immediately discoverable, and let volunteers verify the trial before entering the Event PIN.

## Context

The web app already has a shared event workflow navigation, an event settings form, a separate EventControls component, and a public volunteer check-in page. Recent UI work added an in-app link confirmation for dirty settings and placed EventControls below the form. Browser testing found that browser Back bypasses the link confirmation; it also showed that volunteers see only the opaque Event ID on an event-specific check-in link. The long settings page puts EventControls roughly 2,449 pixels below the top on desktop.

The product serves parents on phones, committee members configuring events, and volunteers checking players in on trial day. Trial-day work should be quick, verifiable, and safe under interruptions.

## Design

### 1. Guard unsaved event settings

Use a React Router data router (`createBrowserRouter` and `RouterProvider`) so `EventFormPage` can use React Router's supported route blocker for link, programmatic, Back, and Forward navigation.

- Dirty state is a comparison between the editable values and the last loaded/saved baseline; there is no autosave.
- When a blocked navigation occurs, keep the existing confirmation copy. Cancel/stay resets the blocked navigation and retains every edit. Confirm/discard proceeds.
- Keep the `beforeunload` warning for reloads and tab/window exits.
- Preserve the sign-out confirmation. If confirmed, allow the intended transition to sign-in without showing a second dirty-form prompt.
- On successful create/update or confirmed event deletion, intentionally allow the expected transition back to the event list; do not show a stale dirty prompt after the server action succeeds.
- While an existing event is loading, show a status message and do not render editable fields. On load failure, keep the page non-editable and offer a retry. New-event creation remains editable immediately.

### 2. Separate event operations from configuration

Add `/admin/events/:id/operations` and an `EventOperationsPage` that loads the event and renders its identity/date and existing `EventControls` component. Keep `EventFormPage` focused on event configuration and the distinct Delete event section. Preserve existing EventControls behavior: lifecycle actions, PIN management, court colors, Admin check-in, and day-of registration.

Add an **Event operations** entry to the shared event workflow navigation. Group workflow links into:

- **Event:** Event settings, Event operations, Roster and export, Review queue
- **Planning:** Plan rounds, Full Game List, Print selector sheets
- **Trial day:** Messages, Volunteer check-in

Desktop keeps the groups visible. Mobile keeps the current-page-labeled Event tools disclosure collapsed by default and shows the same groups when expanded. Only close the disclosure after a successful route change; a canceled dirty-navigation prompt must leave it open.

### 3. Show event identity on volunteer check-in

When `/check-in` is opened with an `eventId` query parameter, load the existing public upcoming-trials list and match by ID. That list already exposes the public event name/date and includes open and closed upcoming events; this avoids exposing Admin data or adding a new API endpoint.

- Show the matched event name and localized date beside the prefilled Event ID.
- Keep the Event ID editable and keep the PIN required, masked, and out of the URL.
- If event details cannot be loaded or the ID is not in the public list, show a non-blocking verification message telling the volunteer to confirm the ID with the coordinator. Do not imply a successful match or remove the existing PIN flow.
- Bind the displayed event name/date to the exact ID that was matched. If the volunteer edits the prefilled ID, clear the old preview immediately and show that the new ID is unverified; never show stale event details beside a different ID.
- Do not fetch event details for the manual-entry page until a query ID is present; never submit credentials during the lookup.

## Architecture and files

- `apps/web/src/main.tsx`: replace declarative `BrowserRouter` bootstrap with the data-router provider needed for `useBlocker`.
- `apps/web/src/App.tsx`: retain the existing app routes and add the operations child route.
- `apps/web/src/routes/EventFormPage.tsx`: implement route blocking, load gating/retry, and the explicit post-save/delete transition; remove EventControls rendering.
- `apps/web/src/admin/EventOperationsPage.tsx` (new): load event context and render EventControls.
- `apps/web/src/admin/EventWorkflowNav.tsx` and `apps/web/src/styles.css`: add the operations destination and grouped responsive workflow links.
- `apps/web/src/checkin/CheckInPage.tsx`: resolve a query-prefilled Event ID against the public event list and show its identity/fallback.
- Relevant tests: `App.test.tsx`, `EventFormPage.test.tsx`, new `EventOperationsPage.test.tsx`, `CheckInPage.test.tsx`, and `EventWorkflowNav` coverage.

No API schema or database change is expected. `listPublicEvents` already supplies the public event identity used by the check-in preview.

## Failure and safety behavior

- A failed settings load never presents a blank editable form; the user can retry.
- A canceled route prompt preserves the current form and location; a confirmed prompt discards edits and follows the attempted destination.
- Successful Save/Delete and confirmed Sign out do not trigger a second prompt. Failed Save/Delete leave edits and the current route intact.
- Event deletion rules remain unchanged: registrations block deletion, and the existing server response remains authoritative.
- Check-in identity lookup failure or a changed Event ID does not expose credentials or prevent the existing manual recovery path.
- No PIN is added to a URL, analytics event, log, or public lookup request.

## Acceptance criteria

1. With a dirty edit, in-app links, Cancel, browser Back, and browser Forward all prompt. Canceling keeps the original route and every edited value; confirming follows the destination.
2. Reload/tab close still raises the browser's unload warning when dirty.
3. Confirmed Sign out prompts once; successful Save, Create, and Delete navigate without an extra dirty warning. Failed writes preserve edits.
4. Existing-event inputs are unavailable until the saved values load. A delayed response cannot overwrite user typing because typing is not possible; a failed request offers retry.
5. Event settings no longer render EventControls. The operations route shows event name/date and the existing lifecycle, PIN, court-color, check-in, and day-of actions.
6. Event workflow navigation marks the current route, groups the destinations as specified, and remains usable at desktop and 390px mobile widths. Canceling a dirty navigation leaves the mobile menu open.
7. A valid event-specific volunteer link shows the public event name/date and prefilled Event ID. Editing that ID clears the matched identity until it can be verified again. A lookup failure gives a verification message; the PIN remains masked and required, and no lookup makes a write request.
8. Web unit tests and production build pass. Browser checks use mocked Admin APIs and do not reset E2E fixtures or mutate live data.

## Non-goals and constraints

- No change to payment, registration eligibility, event lifecycle policy, PIN security, or event-deletion eligibility.
- No autosave, draft persistence, browser-history rewriting, new API endpoint, or database migration.
- Do not restart Compose, run fixture-resetting E2E workflows, use the one-time Admin link, deploy, or push.
- Keep the existing Chisholm blue/plum visual identity and preserve unrelated uncommitted work.
