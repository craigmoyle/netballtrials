# Trials TEST on the VPS

The only hosted Trials site is `https://trials-test.statsball.net`. It runs on the VPS with `NODE_ENV=production`, `APP_ENV=testing`, HTTPS and secure cookies, a dedicated `netballtrials_test` database, and restricted Admin access. There is no Trials production deployment.

## Host configuration

The deployment uses `deploy/vps/compose.yaml` and the root-owned `/opt/netball/.env` file (mode `0600`). PostgreSQL has no published host port; Caddy publishes 80/443 and routes the Trials hostname to the web app and API. The Compose stack is shared with another application on the host, so use the complete environment template at `deploy/vps/.env.example`; this guide covers only Trials.

Trials TEST uses `ENABLE_TEST_INTEGRATIONS=true`, `PAYMENT_PROVIDER=stripe`, and Stripe TEST credentials from the Infisical `test` namespace. Keep provider credentials in Infisical, not the environment file or source. Real test email goes only to current Admins; non-Admin recipients are simulated. Hosted TEST allows up to five Admin accounts. The TEST database and roster were migrated to the VPS, old sessions and login tokens were cleared, and a current Admin successfully signed in. Stripe TEST was confirmed working.

## Deploy or update

From `/opt/netball/netballtrials/deploy/vps`:

```sh
sudo docker compose --env-file /opt/netball/.env -f compose.yaml config -q
sudo docker compose --env-file /opt/netball/.env -f compose.yaml up -d db
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs build trials-api trials-migrate web
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs run --rm trials-migrate
sudo docker compose --env-file /opt/netball/.env -f compose.yaml up -d trials-api web
```

Verify `https://trials-test.statsball.net/` and `/api/health` after a deployment. Keep `VITE_API_URL` empty so browser requests use the same-origin `/api` route. Local development remains on fake payments and in-memory email; never enable hosted integrations locally.

The `postgres_data` volume is persistent. Never run `docker compose down -v`. No persistent off-host backup destination or retention policy is configured. Trials reminder and retention timers remain disabled until their operational acceptance.
