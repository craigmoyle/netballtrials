#!/usr/bin/env bash
# Build, migrate and roll Trials TEST from this checkout (run on the VPS from main).
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=${NETBALL_TRIALS_ENV_FILE:-/opt/netball/trials.env}
COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.yaml)

"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" --profile jobs build trials-api trials-web trials-migrate trials-reminders trials-retention
"${COMPOSE[@]}" --profile jobs run --rm trials-migrate
"${COMPOSE[@]}" up -d --no-deps trials-api trials-web

install -m 0644 systemd/netball-trials-* /etc/systemd/system/
systemctl daemon-reload
echo "Trials deployed. Check: docker ps --filter name=netball-trials"
