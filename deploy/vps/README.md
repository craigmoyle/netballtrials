# Trials TEST on the VPS

The shared VPS serves Stats only at `https://statsball.net` and hosted Trials TEST at `https://trials-test.statsball.net`. Trials runs with `NODE_ENV=production`, `APP_ENV=testing`, HTTPS and secure cookies, a dedicated `netballtrials_test` database, and restricted Admin access. There is no Trials production deployment.

## Host configuration

The deployment uses `deploy/vps/compose.yaml` and the root-owned `/opt/netball/.env` file (mode `0600`). PostgreSQL has no published host port; Caddy publishes 80/443 and routes the Trials hostname to the web app and API. The Compose stack is shared with another application on the host, so use the complete environment template at `deploy/vps/.env.example`; this guide covers only Trials. The API runtime uses a restricted database login; set distinct, unquoted random hex values for `TRIALS_DB_PASSWORD` (migrations) and `TRIALS_RUNTIME_DB_PASSWORD` (normal API access). On an existing data volume, run `upgrade-trials-runtime-role.sh` before updating the API; fresh volumes create the role through the database initialization script. The upgrade script is idempotent and does not print the password.

Trials TEST uses `ENABLE_TEST_INTEGRATIONS=true`, `PAYMENT_PROVIDER=stripe`, and Stripe TEST credentials from the Infisical `test` namespace. Keep provider credentials in Infisical, not the environment file or source. Real test email goes only to current Admins; non-Admin recipients are simulated. Hosted TEST allows up to five Admin accounts. Admin sign-in is by email link, so every Admin mailbox must have MFA enabled. Admin sessions expire after seven days. The TEST database and roster were migrated to the VPS, old sessions and login tokens were cleared, and a current Admin successfully signed in. Stripe TEST was confirmed working. Reset any existing check-in PINs that predate the six-digit minimum before volunteer PIN access; legacy four-digit PINs are rejected.

## Deploy or update

From `/opt/netball/netballtrials/deploy/vps`:

```sh
sudo docker compose --env-file /opt/netball/.env -f compose.yaml config -q
sudo docker compose --env-file /opt/netball/.env -f compose.yaml up -d db
sudo /opt/netball/netballtrials/deploy/vps/upgrade-trials-runtime-role.sh
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs build trials-api trials-migrate web
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs run --rm trials-migrate
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs build trials-reminders trials-retention
sudo docker compose --env-file /opt/netball/.env -f compose.yaml up -d trials-api web
```

Verify `https://trials-test.statsball.net/` and `/api/health` after a deployment. Keep `VITE_API_URL` empty so browser requests use the same-origin `/api` route. Local development remains on fake payments and in-memory email; never enable hosted integrations locally.

## Reminder and retention timers

Install and enable the Trials jobs after deployment:

```sh
sudo install -m 0644 systemd/netball-trials-reminders.service systemd/netball-trials-reminders.timer systemd/netball-trials-retention.service systemd/netball-trials-retention.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now netball-trials-reminders.timer netball-trials-retention.timer
systemctl list-timers 'netball-trials-*'
```

The reminder job runs every 15 minutes and dispatches reminders, confirmation retries, checkout retries, and scheduled communications. The retention job runs daily at 03:00 local server time and removes expired personal data. Monitor both units' logs and exit codes.

The `postgres_data` volume is persistent. Never run `docker compose down -v`. No persistent off-host backup destination or retention policy is configured.
