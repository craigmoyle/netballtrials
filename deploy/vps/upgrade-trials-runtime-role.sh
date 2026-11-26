#!/usr/bin/env bash
# Run before deploying the restricted API role on an existing database volume.
# Reads only the required fields from the root-only env files; never prints them.
set -euo pipefail

ENV_FILE=${NETBALL_TRIALS_ENV_FILE:-/opt/netball/trials.env}
PLATFORM_ENV_FILE=${NETBALL_PLATFORM_ENV_FILE:-/opt/netball/platform.env}
PLATFORM_COMPOSE_FILE=${NETBALL_PLATFORM_COMPOSE_FILE:-/opt/netball/netball-vps/compose.yaml}
SQL_FILE="$(cd "$(dirname "$0")" && pwd)/sql/upgrade-trials-runtime-role.sql"
[[ -r "$ENV_FILE" && -r "$PLATFORM_ENV_FILE" && -r "$SQL_FILE" ]] || { echo 'Required environment or SQL file is missing.' >&2; exit 1; }

read_env_value() {
  local value
  value=$(awk -F= -v key="$2" '$1 == key { print substr($0, index($0, "=") + 1); found=1; exit } END { if (!found) exit 1 }' "$1")
  if (( ${#value} >= 2 )) && { [[ "$value" == \"*\" ]] || [[ "$value" == \'*\' ]]; }; then
    value=${value:1:${#value}-2}
  fi
  printf '%s\n' "$value"
}

POSTGRES_ADMIN_PASSWORD=$(read_env_value "$PLATFORM_ENV_FILE" POSTGRES_ADMIN_PASSWORD)
TRIALS_RUNTIME_DB_PASSWORD=$(read_env_value "$ENV_FILE" TRIALS_RUNTIME_DB_PASSWORD)
TRIALS_DB_PASSWORD=$(read_env_value "$ENV_FILE" TRIALS_DB_PASSWORD)
export PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" TRIALS_RUNTIME_DB_PASSWORD

: "${PGPASSWORD:?Set POSTGRES_ADMIN_PASSWORD in the platform env file}"
: "${TRIALS_RUNTIME_DB_PASSWORD:?Set TRIALS_RUNTIME_DB_PASSWORD in the Trials env file}"
: "${TRIALS_DB_PASSWORD:?Set TRIALS_DB_PASSWORD in the Trials env file}"
[[ "$TRIALS_RUNTIME_DB_PASSWORD" != "$TRIALS_DB_PASSWORD" ]] || { echo 'Runtime and migration database passwords must differ.' >&2; exit 1; }

docker compose --env-file "$PLATFORM_ENV_FILE" -f "$PLATFORM_COMPOSE_FILE" exec -T \
  -e PGPASSWORD -e TRIALS_RUNTIME_DB_PASSWORD db \
  psql -h 127.0.0.1 -U netball_host_admin -d postgres --no-psqlrc -v ON_ERROR_STOP=1 -f - < "$SQL_FILE"
