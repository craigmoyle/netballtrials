# Netball Trials

React/Vite web app and Fastify/Prisma API for Chisholm Netball Region trials. Requires Node.js 22+ and PostgreSQL.

## Local development

```sh
npm install
cp apps/api/.env.example apps/api/.env
cd apps/api && npx prisma migrate dev
```

In separate terminals run `npm run dev:api` and `npm run dev:web` from the repository root. The Vite server proxies `/api` to `http://localhost:3000`; override `VITE_API_PROXY_TARGET` if the API runs elsewhere. Local development explicitly uses the fake payment provider. Never deploy that provider or its signature outside development/tests.

## Production API

Provide environment variables through the deployment's secret/configuration system; do not commit `.env` or credentials. Set `NODE_ENV=production`, `PAYMENT_PROVIDER=stripe`, both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, an offline `GMAIL_REFRESH_TOKEN`, `DATABASE_URL`, public `WEB_ORIGIN` and `API_PUBLIC_URL`, and `SESSION_COOKIE_SECURE=true`. The OAuth consent setup must request offline access and the narrow `https://www.googleapis.com/auth/gmail.send` scope; the authorized mailbox, From and Reply-To are fixed to `chisholmnetball@gmail.com`. Store OAuth secrets only in the deployment secret manager. `WEB_ORIGIN` must be the exact browser origin. If deployed behind a reverse proxy, set `TRUST_PROXY` only to that proxy's exact IPs/CIDRs so request rate limits use the client address without trusting arbitrary forwarded headers. Startup fails if Stripe/Gmail settings are incomplete, insecure cookies or non-HTTPS production origins are configured, or any mailer other than the Gmail API provider is injected.

Apply database migrations with `cd apps/api && npx prisma migrate deploy`. Build/typecheck with `npm run build -w @netball-trials/api` and start with `npm run start -w @netball-trials/api`. The production runtime includes `tsx`; the build command currently performs a typecheck rather than emitting JavaScript. Set `PORT` as needed. Route the configured web origin to the web app and `/api` to the API, or configure the web build's `VITE_API_URL` with the matching API origin and CORS/cookie settings.

Local development uses an in-memory mailer and never delivers messages. Preview reminders safely with `npm run send-reminders -- --dry-run`; live reminder runs refuse non-production mode. Production uses the Gmail API with OAuth; SMTP is not used. After OAuth credentials are provisioned, create the first admin once with `npm run admin:bootstrap -- admin@example.com`; subsequent admins are invited from the authenticated staff workflow. Schedule `npm run send-reminders` at least every 15 minutes during the 24-hour window and `npm run retention` daily, using the selected host's scheduler. The 12-calendar-month application retention job does not expire database backups; configure and verify backup expiry separately with the hosting provider.

## Checks

```sh
npm test
npm run build
npx tsc -p apps/web/tsconfig.json --noEmit
npm audit
```

API tests use `apps/api/.env.test` and refuse to run against a non-`_test` database. Never override that guard to point tests at production data.

Browser acceptance tests run with `npm run test:e2e`. They require a local Google Chrome installation and use Playwright against the guarded `netballtrials_test` database; the E2E server applies migrations and resets that database between tests. The test API uses the in-memory mailer and fake checkout provider; no Gmail or Stripe requests are made, and the checkout return remains pending. A separately pre-seeded ticket fixture exercises ticket rendering without claiming a payment. The suite runs Chromium via Chrome (verified here with Chrome 155.0.8059.40) at 1280×900, 768×1024 and 390×844 viewports, with axe WCAG 2.2 AA checks. The volunteer camera test uses Chromium's synthetic camera stream and manual lookup; no physical QR/camera, outdoor-light or club-printer acceptance test has been run. The PDF check uses Chrome headless print-to-PDF, not a physical printer.
