# Netball Trials

React/Vite web app and Fastify/Prisma API for Chisholm Netball Region trials. Requires Node.js 22+ and PostgreSQL.

## Local development

```sh
docker --context rancher-desktop compose up -d db
npm install
cp apps/api/.env.example apps/api/.env
cd apps/api && npx prisma migrate dev
```

The sample `DATABASE_URL` points to Rancher Desktop's host-mapped PostgreSQL on port 55432. Override it for another local PostgreSQL instance. In separate terminals run `npm run dev:api` and `npm run dev:web` from the repository root. The Vite server proxies `/api` to `http://localhost:3000`; override `VITE_API_PROXY_TARGET` if the API runs elsewhere. Local development explicitly uses the fake payment provider. Never deploy that provider or its signature outside development/tests.

## Rancher Desktop local test stack

Rancher Desktop must be running with Docker/Compose support. This stack is a local, disposable UI environment; it is not Kubernetes and does not use production services or credentials. If the Docker CLI is not already pointed at Rancher Desktop, use its explicit context without changing the global context:

```sh
docker --context rancher-desktop compose up --build -d
```

Open the web app at `http://localhost:5173`. The API is at `http://localhost:3000`, the local test-control service is at `http://localhost:3001`, and PostgreSQL's optional host port is `55432`. All published ports bind to `127.0.0.1`. Vite hot-reloads web and shared-type source changes; the Compose web service uses 500ms file polling for Rancher Desktop's bind mount, while host-run Vite keeps its native watcher. After API source changes, restart its service; that recreates the seeded fixtures and clears the in-memory mail outbox. Rebuild after dependency or Dockerfile changes:

```sh
docker --context rancher-desktop compose restart api
docker --context rancher-desktop compose up --build -d
```

The API uses `netballtrials_test`, fake Checkout and an in-memory mailer. It applies migrations and seeds sample events on startup. Public registration first sends an email-confirmation link; the parent must confirm it before continuing to the local test-payment simulation. This simulation never takes a real payment. A separate paid fixture is provided for ticket/QR/calendar UI review. No Stripe or Gmail requests are made. Inspect local magic links and messages at `http://localhost:3001/__test/outbox`; restore fixtures with `curl -X POST http://localhost:3001/__test/reset`. The control endpoints are test-only and host-loopback-published.

Run the browser suite while the Compose stack is up to reuse its services:

```sh
npm run test:e2e
```

To test without resetting an already-running stack, create a separate disposable database ending in `_test`, set `E2E_DATABASE_URL` to it, and choose unused `E2E_WEB_PORT`, `E2E_API_PORT` and `E2E_CONTROL_PORT` values. Set `CI=1` to require fresh servers rather than reusing listeners. Playwright stops those servers when the run finishes.

With the Compose API/web services stopped, Playwright starts its own API/web servers and uses `E2E_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/netballtrials_test`). If only the Rancher database service is running on port 55432, set `E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/netballtrials_test`. The Rancher PostgreSQL service uses its own named volume, separate from any host PostgreSQL or other Compose project. It contains both `netballtrials` for host-run development and `netballtrials_test` for E2E. Stop the stack while retaining these databases with `docker --context rancher-desktop compose down`; add `--volumes` only when you want to erase both local databases.

Provider-integration testing is deferred. The future Stripe test profile will use Stripe test mode and Stripe CLI; the Gmail test profile will use an API-compatible OAuth/send mock, not SMTP or Mailpit.

## Production API

Provide environment variables through the deployment's secret/configuration system; do not commit `.env` or credentials. Set `NODE_ENV=production`, `PAYMENT_PROVIDER=stripe`, both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, an offline `GMAIL_REFRESH_TOKEN`, `DATABASE_URL`, public `WEB_ORIGIN` and `API_PUBLIC_URL`, and `SESSION_COOKIE_SECURE=true`. The OAuth consent setup must request offline access and the narrow `https://www.googleapis.com/auth/gmail.send` scope; the authorized mailbox, From and Reply-To are fixed to `chisholmnetball@gmail.com`. Store OAuth secrets only in the deployment secret manager. `WEB_ORIGIN` must be the exact browser origin. If deployed behind a reverse proxy, set `TRUST_PROXY` only to that proxy's exact IPs/CIDRs so request rate limits use the client address without trusting arbitrary forwarded headers. Startup fails if Stripe/Gmail settings are incomplete, insecure cookies or non-HTTPS production origins are configured, or any mailer other than the Gmail API provider is injected.

Apply database migrations with `cd apps/api && npx prisma migrate deploy`. Build/typecheck with `npm run build -w @netball-trials/api` and start with `npm run start -w @netball-trials/api`. The production runtime includes `tsx`; the build command currently performs a typecheck rather than emitting JavaScript. Set `PORT` as needed. Route the configured web origin to the web app and `/api` to the API, or configure the web build's `VITE_API_URL` with the matching API origin and CORS/cookie settings.

Parents must verify their email before continuing to Checkout. The passwordless **Manage registrations** portal groups all registrations by verified parent email, including siblings. Sign-in and verification links are single-use, expire after 15 minutes, and require an explicit Continue step. Email verification establishes inbox control, not guardianship; the separate registration authority confirmation is still required. Parents can update permitted details or withdraw before event closure; withdrawals do not refund payment. Email-address changes require verification at the new address and notify the old address. Admins can review incomplete registration stages and send payment follow-up only to verified addresses.

Local development uses an in-memory mailer and never delivers messages. Preview reminders safely with `npm run send-reminders -- --dry-run`; live reminder runs refuse non-production mode. Production uses the Gmail API with OAuth; SMTP is not used. After OAuth credentials are provisioned, create the first admin once with `npm run admin:bootstrap -- admin@example.com`; subsequent admins are invited from the authenticated staff workflow. Schedule `npm run send-reminders` at least every 15 minutes; this sends the day-before reminder in its 24-hour window and dispatches due scheduled communications. Schedule `npm run retention` daily, using the selected host's scheduler. The retention job anonymizes incomplete submissions after 30 days and deletes or anonymizes completed event registration and communication data four calendar years after the event. It does not cover Gmail Sent copies, member-association contacts, financial books, or database backups. Association contacts stay until an Admin changes or clears them. Maintain the incorporated association's financial records separately for at least seven years. Gmail copies follow the mailbox/provider retention policy; configure and verify database backup expiry separately with the hosting provider.

### Mail and retention recovery

Monitor scheduler exit codes and stderr. Retention exits **1** when an expired event has unresolved `SENDING` deliveries or interrupted claims (`AMBIGUOUS` with `delivery_interrupted_after_claim`). It reports event IDs, delivery IDs and attempt numbers, without recipient details. Other events can still be cleaned; a zero anonymised count does not mean retention is complete. Claims remain blocking indefinitely until the worker finishes or an operator resolves them. A stale lease or elapsed time is **not** evidence that a worker has stopped.

For an abandoned claim:

1. Identify the original API/reminder worker, stop it, and prevent it from resuming or being restarted with that in-flight send. Check all relevant instances/jobs. If you cannot establish that the original worker is stopped, do not acknowledge or resolve the claim; wait or investigate. Database fencing cannot cancel a provider request or erase a live worker's memory.
2. Inspect the delivery ID and current attempt number from the retention report (or the `EmailLog` record) and verify that `DATABASE_URL` targets the intended database. Check provider evidence separately: use `verified-sent` only when that exact delivery was confirmed sent; use `unknown` if the outcome cannot be established. Neither age nor absence of a provider record proves non-delivery.
3. With the deployment's database configuration loaded, run this operator-only command from the repository root, substituting the inspected ID and attempt number:

   ```sh
   npm run mail:reconcile -w @netball-trials/api -- \
     --delivery-id '<delivery-id>' --expected-attempt 2 \
     --outcome unknown --acknowledge-worker-stopped
   ```

   For independently verified delivery, replace `unknown` with `verified-sent`. The acknowledgement is mandatory. This CLI makes no Gmail calls and sends no email; there is no public recovery endpoint. It transactionally resolves only the exact unresolved claim. A changed/completed claim or different attempt exits nonzero without modifying it; inspect again rather than blindly increasing the expected attempt. The original worker's late completion cannot overwrite the resolution. `sentAt` for `verified-sent` records reconciliation time, not a reconstructed provider timestamp.
4. Rerun `npm run retention -w @netball-trials/api` and check its exit code. `unknown` becomes ordinary `AMBIGUOUS`, never an automatic resend, and no longer blocks cleanup. Before the retention cutoff, a separate explicit ambiguous retry is possible but may duplicate a message; assess that risk first. Do not retry expired data or backdate the job clock to bypass retention.

If event details change after a reminder batch is created, its original content stays immutable. Reminder errors report unsent rows and newly paid households omitted from that batch (one registration ID per distinct address), even if every original delivery was sent. Send an updated message manually to the affected households using the current details; do not replay the old venue/time or silently resend the entire batch.

## Checks

```sh
npm test
npm run build
npx tsc -p apps/web/tsconfig.json --noEmit
npm audit
```

API tests use `apps/api/.env.test` and refuse to run against a non-`_test` database. Never override that guard to point tests at production data.

Browser acceptance tests run with `npm run test:e2e`. They require a local Google Chrome installation and use Playwright against the guarded `netballtrials_test` database; the E2E server applies migrations and resets that database between tests. The test API uses the in-memory mailer and fake checkout provider; no Gmail or Stripe requests are made, and the checkout return remains pending. A separately pre-seeded ticket fixture exercises ticket rendering without claiming a payment. The suite runs Chromium via Chrome (verified here with Chrome 155.0.8059.40) at 1280×900, 768×1024 and 390×844 viewports, with axe checks on selected screens; this is not a WCAG conformance assessment. The volunteer E2E flow uses manual lookup. Component tests mock the camera decoder, so camera QR scanning has not been exercised end-to-end; no physical QR/camera, outdoor-light or club-printer acceptance test has been run. The PDF check uses Chrome headless print-to-PDF, not a physical printer.
