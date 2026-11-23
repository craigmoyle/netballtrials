#!/usr/bin/env bash
# Run before deploying the restricted API role on an existing database volume.
# Reads only the required fields from the root-only env file; never prints them.
set -euo pipefail

ENV_FILE=${NETBALL_ENV_FILE:-/opt/netball/.env}
ROOT=${NETBALL_ROOT:-/opt/netball/netballtrials}
COMPOSE_FILE="$ROOT/deploy/vps/compose.yaml"
SQL_FILE="$ROOT/deploy/vps/sql/upgrade-trials-runtime-role.sql"
[[ -r "$ENV_FILE" && -r "$SQL_FILE" ]] || { echo 'Required environment or SQL file is missing.' >&2; exit 1; }

read_env_value() {
  awk -F= -v key="$1" '$1 == key { print substr($0, index($0, "=") + 1); found=1; exit } END { if (!found) exit 1 }' "$ENV_FILE"
}

POSTGRES_ADMIN_PASSWORD=$(read_env_value POSTGRES_ADMIN_PASSWORD)
TRIALS_RUNTIME_DB_PASSWORD=$(read_env_value TRIALS_RUNTIME_DB_PASSWORD)
TRIALS_DB_PASSWORD=$(read_env_value TRIALS_DB_PASSWORD)
export PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" TRIALS_RUNTIME_DB_PASSWORD

: "${PGPASSWORD:?Set POSTGRES_ADMIN_PASSWORD in the host env file}"
: "${TRIALS_RUNTIME_DB_PASSWORD:?Set TRIALS_RUNTIME_DB_PASSWORD in the host env file}"
: "${TRIALS_DB_PASSWORD:?Set TRIALS_DB_PASSWORD in the host env file}"
[[ "$TRIALS_RUNTIME_DB_PASSWORD" != "$TRIALS_DB_PASSWORD" ]] || { echo 'Runtime and migration database passwords must differ.' >&2; exit 1; }

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
  -e PGPASSWORD -e TRIALS_RUNTIME_DB_PASSWORD db \
  psql -h 127.0.0.1 -U netball_host_admin -d postgres --no-psqlrc -v ON_ERROR_STOP=1 -f - < "$SQL_FILE"
