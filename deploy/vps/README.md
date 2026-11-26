# Trials TEST on the VPS

Trials TEST runs at `https://trials-test.statsball.net` from this directory. It is deployed separately from Stats: its own Compose project (`netball-trials`), its own images, its own env file and its own systemd timers. The shared PostgreSQL and TLS edge come from the `netball-vps` platform repo, which must be running first.

There is no Trials production deployment. The TEST deployment uses `NODE_ENV=production`, `APP_ENV=testing`, HTTPS and secure cookies, the `netballtrials_test` database, and restricted Admin access.

## Host layout

- `/opt/netball/netballtrials` – checkout of `main`
- `/opt/netball/trials.env` – Trials secrets (mode `0600`, root-only); template in `trials.env.example`
- `/opt/netball/platform.env` – platform secrets, owned by `netball-vps`

Role passwords (`TRIALS_DB_PASSWORD`, `TRIALS_RUNTIME_DB_PASSWORD`) must match between the platform and Trials env files. Use distinct, unquoted random hex values.

## Deploy

Deploy only from merged `main`:

```sh
cd /opt/netball/netballtrials/deploy/vps
sudo ./deploy.sh
```

`deploy.sh` validates the Compose file, builds the API, web and job images, runs migrations, recreates `trials-api` and `trials-web`, and installs the systemd units. On an existing database volume, run `upgrade-trials-runtime-role.sh` once before the first deploy that changes the API role; the script is idempotent and never prints passwords.

Verify `https://trials-test.statsball.net/` and `/api/health` after a deployment. `VITE_API_URL` stays empty so browser requests use the same-origin `/api` route. Local development stays on fake payments and in-memory email; never enable hosted integrations locally.

## Request path

Client → edge (TLS, `netball-vps`) → `trials-web` (static files, headers, API proxy) → `trials-api`. `trials-web` trusts only the edge subnet (`172.30.50.0/24`); `trials-api` trusts only `trials-web` (`172.30.30.2`).

## Access and operations

- Admin sign-in is by email link, so every Admin mailbox must have MFA enabled. Hosted TEST allows up to five Admin accounts; Admin sessions expire after seven days.
- Stripe TEST credentials and other provider secrets come from Infisical's `test` namespace, not the env file.
- Real test email goes only to current Admins; other recipients are simulated.
- Volunteer PINs need six digits; legacy four-digit PINs are rejected.

## Jobs and timers

- `netball-trials-reminders` runs every 15 minutes: reminders, confirmation and checkout retries, and scheduled communications.
- `netball-trials-retention` runs daily at 03:00 local server time and removes expired personal data.

Run a job manually with `sudo docker compose --env-file /opt/netball/trials.env -f compose.yaml --profile jobs run --rm --no-deps <service>`.

## Rules

- Never run `docker compose down -v`. The `netball_postgres_data` volume is owned by the platform project and holds all databases.
- No persistent off-host backup destination or retention policy is configured.
