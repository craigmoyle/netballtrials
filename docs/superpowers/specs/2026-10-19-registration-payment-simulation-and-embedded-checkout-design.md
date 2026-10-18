# Registration Payment Simulation and Stripe Embedded Checkout

**Date:** 2026-10-19
**Status:** Draft for review

## Goal

Let a parent exercise the paid-registration and ticket journey locally without entering card details or moving money. Separately, define a safe Stripe Embedded Checkout flow for the future test deployment, using Stripe test credentials and a test mail sandbox.

The current implementation scope is the local fake-payment simulation. Stripe Embedded Checkout, Mailpit transport, and deployment configuration are future work; this document does not authorize configuring keys or deploying either service.

## Current behavior

- Public registration creates a `PENDING` registration and sends a checkout link. The public endpoint returns a neutral acknowledgement so its response does not disclose whether a player is already registered.
- Admin-assisted registration also sends the parent a checkout link; volunteers do not collect card details.
- `FakePaymentProvider` creates synthetic checkout sessions. `StripePaymentProvider` currently creates hosted Stripe Checkout Sessions.
- The payment webhook validates the session, amount, currency, and event idempotency before marking a registration `PAID` and issuing its ticket. `RegistrationPendingPage` can poll the session status.
- Development/test uses `DevMailer`; production currently requires Gmail. Fake payment is not permitted in production.

## Decisions

### Phase 1: local fake-payment simulation

The fake flow is for local development and automated tests only. It is not enabled on the future Stripe test deployment or in production.

1. A parent submits the existing public registration form. A valid request creates a pending registration and fake checkout session.
2. In fake-provider mode, the registration route does not email a checkout link for a new self-service registration. Instead, the page shows a clearly labeled **Test payment simulation — no real payment** step and a **Simulate successful payment** action.
3. The simulation has no card-number, expiry, or security-code fields. It makes no real payment request and stores no card data.
4. The API returns only an opaque, high-entropy fake session capability—not a registration ID, player details, or parent details. In fake mode, every accepted `202` response has the same `received` status and `simulationToken` field shape. Bind a token only to a newly created payable session; for duplicate acknowledgements, return a random unbound token. Never return an existing pending or paid registration’s session capability to the duplicate requester.
5. The fake completion endpoint is available only when `PAYMENT_PROVIDER=fake` and `NODE_ENV` is not `production`. It verifies that the capability resolves to the expected pending, unexpired registration and session, then invokes the same payment-confirmation logic used by the webhook. It must not directly set `PAID` or issue a ticket outside that logic.
6. Successful simulation marks the test registration paid, issues its ticket, and sends the confirmation through `DevMailer`. Replays are idempotent. Invalid, expired, or unbound capabilities produce a generic result and do not expose registration status or personal data.
7. Fake session IDs must be unpredictable; the current sequential fake IDs are not suitable as capabilities. The existing `checkoutSessionId` can hold the fake session reference, avoiding a schema change for this phase.
8. Admin-assisted registration remains email-based. In fake mode, its checkout continuation continues to go to the parent through `DevMailer`; a volunteer never operates the payment simulation on the parent’s behalf.

The fake UI may be shown only in a local fake-provider build. The initial registration acknowledgement must not reveal whether a duplicate registration exists. Duplicate-handling behavior and its existing guidance email remain intact.

### Phase 2: Stripe Embedded Checkout on the test deployment

This is a design target, not part of the Phase 1 implementation.

1. The public registration request continues to return a neutral acknowledgement. It does not return a Stripe client secret before email ownership is established.
2. The API creates an embedded Stripe Checkout Session for the pending registration but does not return its client secret in the public registration response. The parent receives a short-lived checkout-continuation link at the supplied email address. Opening it returns to the app and acts as the email-verification step. The link contains only the opaque Checkout Session ID, not registration or player details. While the session is pending, the link can be reopened for recovery. Once paid or expired, it resolves to the appropriate status/ticket or closed-state page and never mounts another checkout.
3. After validating that capability and confirming the registration is still payable, the API retrieves the embedded Stripe Checkout Session and returns its client secret to the app. The app mounts Stripe Embedded Checkout on the Chisholm site. Stripe.js handles all card entry.
4. Stripe’s signed webhook remains authoritative. Existing amount, currency, session, and idempotency checks continue to gate the `PENDING` → `PAID` transition and ticket issuance. The return page continues to poll for the webhook result rather than trusting a browser success callback.
5. Admin-assisted registration remains email-based: the parent opens the secure app link and completes checkout there. Volunteers do not enter or handle card details.
6. The test deployment uses Stripe test publishable, secret, and webhook-signing keys only. Its email links and confirmations go to a Mailpit test inbox, not Gmail and not real parents. Use a non-deliverable test sender address; restrict the Mailpit inbox to the test team and do not relay captured messages externally.
7. Add explicit test-deployment mail configuration for Mailpit. Do not use `NODE_ENV=development` on a public host to bypass production protections. The test deployment must have a distinct, explicit configuration profile, a separate test database, secure cookies, and production-equivalent request protections. Production’s fake-payment prohibition and mail requirements remain in force.

The test-deployment host and the exact configuration variable names remain to be chosen when that deployment is planned. No Stripe keys, Mailpit credentials, or host-specific settings are included here.

## API and UI boundaries

### Local fake simulation

- The client receives the fake simulation capability only in local fake-provider mode and keeps it out of user-visible copy.
- A dedicated fake-completion operation accepts that capability; it cannot accept a registration ID as authority.
- The server checks provider/environment mode, session match, pending status, expiry, amount, and currency before passing a synthetic fake event through the established confirmation path.
- The public page shows a generic recovery message if simulation cannot be completed. It must not say whether a matching registration is already paid, pending, or absent.

### Future Stripe test flow

- Add a checkout continuation page/route that mounts Embedded Checkout only after the email link has been validated. The link is a time-limited bearer capability, not a registration identifier. Reopening it may recover the flow, but the payment form is available only while the associated Checkout Session remains pending; other statuses resolve without a new payment form.
- Extend the payment-provider contract to distinguish hosted checkout from embedded checkout and to return an embedded client secret only on the verified continuation path.
- Configure a Stripe test publishable key for the web client. The API keeps Stripe secret and webhook-signing keys server-side.
- Introduce an explicit Mailpit mail-provider setting and test sender identity for the test deployment while keeping `DevMailer` for local development and preserving production-only constraints.

## Acceptance criteria

### Phase 1 implementation

- A valid public registration in local fake mode reaches a visible, clearly labeled, card-free simulation step.
- Simulating success marks only the matching pending test registration paid and produces the same ticket/status result as the real confirmation path.
- Repeating completion does not create another ticket or duplicate confirmation. Invalid, expired, or unbound capabilities do not change registration state or reveal personal/registration details.
- Public registration acknowledgement remains neutral for accepted new and duplicate requests.
- The fake-completion route is unavailable when Stripe is selected and in production.
- Admin-assisted registration still sends the parent a continuation link; it does not collect card details on the volunteer’s device.
- API and web tests cover the success path, idempotency, invalid/expired/unbound capabilities, environment guards, and unchanged Admin-assisted behavior.

### Future test-deployment phase

- Testers open a time-limited verification/continuation link from Mailpit and complete Stripe Embedded Checkout on the app site using Stripe test credentials. Reopening a link after payment or expiry resolves to status without offering another checkout.
- No client secret is returned before link validation; no card data passes through the app API.
- A signed Stripe test webhook is required to mark payment paid and issue a ticket; duplicate and out-of-order webhook deliveries remain safe.
- Mailpit captures messages without sending them externally. No Gmail or live Stripe credentials are used.

## Non-goals

- Live payments, live Stripe credentials, Gmail delivery, or production deployment.
- Adding card-entry fields to the app or placing a volunteer in the cardholder role.
- Changing registration eligibility, duplicate-registration, or event-deletion rules.
- Implementing the Stripe/Mailpit test deployment as part of Phase 1.
