# Single-VPS staging deployment

This stack serves public Stats at `statsball.net` (with `vps.statsball.net` as an operator alias) and hosted Trials TEST at `trials-test.statsball.net`. Trials TEST runs on this VPS. PostgreSQL has no published host port; Caddy alone publishes 80/443.

## Host prerequisites

Debian host with Docker Engine and Compose, UFW allowing 22/tcp, 80/tcp, and 443/tcp, and DNS records for `statsball.net`, `vps.statsball.net`, and `trials-test.statsball.net`. Store the generated environment file at `/opt/netball/.env`, owned by root with mode `0600`; never commit it.

Create unique database passwords on the host (hex avoids URL/SQL escaping):

```sh
sudo install -d -o root -g root -m 0700 /opt/netball
sudo sh -c 'umask 077; printf "STATS_DOMAIN=vps.statsball.net\nSTATS_PRIMARY_DOMAIN=statsball.net\nTRIALS_DOMAIN=trials-test.statsball.net\nPOSTGRES_ADMIN_PASSWORD=%s\nSTATS_DB_OWNER_PASSWORD=%s\nSTATS_API_DB_PASSWORD=%s\nSTATS_TELEMETRY_WRITER_PASSWORD=%s\nSTATS_TELEMETRY_REPORT_PASSWORD=%s\nTRIALS_DB_PASSWORD=%s\nNETBALL_STATS_BROWSER_APPINSIGHTS_CONNECTION_STRING=\n" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > /opt/netball/.env'
sudo install -d -o root -g root -m 0700 /opt/netball/reports
```

Trials TEST uses `ENABLE_TEST_INTEGRATIONS=true`, `PAYMENT_PROVIDER=stripe`, and the Infisical `test` namespace; provider credentials remain in Infisical. Its TEST database and Admin roster were migrated to the VPS, old sessions/tokens were cleared, and a current Admin successfully signed in. Stripe TEST is confirmed working by the user. Test mail remains limited to current Admins. Stats telemetry and Ideas use the private `telemetry` PostgreSQL schema with insert-only API access. `vps.statsball.net` traffic is server-tagged `testing`; `statsball.net` traffic retains its public class. The weekly report excludes internal/testing events from public totals but includes labeled Ideas submissions. It writes root-only Markdown under `/opt/netball/reports`; records older than 90 days are pruned weekly.

## First start

From the deployed sibling-repository layout `/opt/netball/netballtrials` and `/opt/netball/netballstats`:

```sh
cd /opt/netball/netballtrials/deploy/vps
sudo docker compose --env-file /opt/netball/.env -f compose.yaml config -q
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs build db
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs build stats-api
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs build trials-api
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs build trials-migrate
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs build web
sudo docker compose --env-file /opt/netball/.env -f compose.yaml up -d db
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs run --rm stats-telemetry-init
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs run --rm trials-migrate
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs run --rm trials-seed-test
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs run --rm stats-full-refresh
sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs run --rm stats-international-refresh
sudo docker compose --env-file /opt/netball/.env -f compose.yaml up -d stats-api trials-api web
```

Then verify Caddy certificates and `/health` on both hosts, public Stats data routes, secure cookies, and resource headroom.

## Stats refresh timers

After the first full and international builds and API/memory checks pass, install and enable the two Stats timers:

```sh
sudo install -m 0644 systemd/netball-stats-full.service systemd/netball-stats-full.timer systemd/netball-stats-international.service systemd/netball-stats-international.timer systemd/netball-stats-telemetry-report.service systemd/netball-stats-telemetry-report.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now netball-stats-full.timer netball-stats-international.timer netball-stats-telemetry-report.timer
systemctl list-timers 'netball-stats-*'
```

The full job is scheduled Sat 11:00, Sun 08:00, Tue 09:00 UTC; international is Tue/Fri 11:00 UTC. Both use a shared `flock` lock. Trials reminder/retention timers are intentionally not enabled while TEST email integrations are disabled; add them only after the TEST mail workflow and retention behavior are accepted.

The weekly report runs Mondays at 08:00 Australia/Sydney. Retrieve it with `sudo ls -l /opt/netball/reports` and `sudo less /opt/netball/reports/weekly-usage-YYYYMMDD.md`; files are mode 0600 because they contain Ideas feedback. To run it manually, use `sudo docker compose --env-file /opt/netball/.env -f compose.yaml --profile jobs run --rm --no-deps stats-telemetry-report`. The API tags requests from `NETBALL_STATS_TESTING_HOSTS` as testing; the VPS alias remains excluded from public totals after the primary domain cutover.

Caddy serves both `vps.statsball.net` and `statsball.net` from the same Stats build. The `statsball.net` A and AAAA records now point to the VPS, and HTTPS/API checks pass on the primary hostname. `NETBALL_STATS_TESTING_HOSTS=vps.statsball.net` keeps the operator alias out of public telemetry while the primary host retains public classification. Deployment commands do not modify DNS.

The `postgres_data` volume is persistent. Never use `docker compose down -v` on this stack. The initial database script creates separate Stats owner/read-only API and Trials roles and enables `pgaudit` plus `pg_trgm`; `stats-telemetry-init` creates restricted telemetry writer/reporter roles and the telemetry schema idempotently.
