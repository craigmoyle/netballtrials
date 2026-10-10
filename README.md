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

Provide environment variables through the deployment's secret/configuration system; do not commit `.env` or credentials. Set `NODE_ENV=production`, `PAYMENT_PROVIDER=stripe`, both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`, public `WEB_ORIGIN` and `API_PUBLIC_URL`, and `SESSION_COOKIE_SECURE=true`. `WEB_ORIGIN` must be the exact browser origin. If deployed behind a reverse proxy, set `TRUST_PROXY` only to that proxy's exact IPs/CIDRs so request rate limits use the client address without trusting arbitrary forwarded headers. Startup fails if Stripe settings are incomplete, insecure cookies are configured, or the development mailer would be used. The Gmail OAuth provider and its required environment variables are added by the Gmail remediation workstream.

Apply database migrations with `cd apps/api && npx prisma migrate deploy`. Build/typecheck with `npm run build -w @netball-trials/api` and start with `npm run start -w @netball-trials/api`. The production runtime includes `tsx`; the build command currently performs a typecheck rather than emitting JavaScript. Set `PORT` as needed. Route the configured web origin to the web app and `/api` to the API, or configure the web build's `VITE_API_URL` with the matching API origin and CORS/cookie settings.

Email delivery is being integrated through Gmail OAuth in the remediation work. Do not treat the development mailer as production delivery. Admin bootstrap, deployment secrets and reminder/retention scheduling will be documented as those remediation tasks land.

## Checks

```sh
npm test
npm run build
npx tsc -p apps/web/tsconfig.json --noEmit
npm audit
```

API tests use `apps/api/.env.test` and refuse to run against a non-`_test` database. Never override that guard to point tests at production data.
