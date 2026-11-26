#!/usr/bin/env bash
# Build, migrate and roll Trials TEST from this checkout (run on the VPS from main).
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=${NETBALL_TRIALS_ENV_FILE:-/opt/netball/trials.env}
PLATFORM_ENV_FILE=${NETBALL_PLATFORM_ENV_FILE:-/opt/netball/platform.env}
PLATFORM_COMPOSE_FILE=${NETBALL_PLATFORM_COMPOSE_FILE:-/opt/netball/netball-vps/compose.yaml}

[[ $EUID -eq 0 ]] || { echo 'Run this deployment as root.' >&2; exit 1; }
for command in docker flock install systemctl stat; do
  command -v "$command" >/dev/null || { echo "Required command is unavailable: $command" >&2; exit 1; }
done
for file in "$ENV_FILE" "$PLATFORM_ENV_FILE" "$PLATFORM_COMPOSE_FILE" compose.yaml; do
  [[ -r "$file" ]] || { echo "Required deployment file is not readable: $file" >&2; exit 1; }
done
for file in "$ENV_FILE" "$PLATFORM_ENV_FILE"; do
  permissions=$(stat -c '%u:%a' "$file")
  [[ "$permissions" == 0:600 ]] || { echo "$file must be root-owned with mode 0600." >&2; exit 1; }
done

read_env_value() {
  local value
  value=$(awk -F= -v key="$2" '$1 == key { print substr($0, index($0, "=") + 1); found=1; exit } END { if (!found) exit 1 }' "$1")
  if (( ${#value} >= 2 )) && { [[ "$value" == \"*\" ]] || [[ "$value" == \'*\' ]]; }; then
    value=${value:1:${#value}-2}
  fi
  printf '%s\n' "$value"
}

TRIALS_DOMAIN=$(read_env_value "$ENV_FILE" TRIALS_DOMAIN) || { echo 'TRIALS_DOMAIN is missing.' >&2; exit 1; }
PLATFORM_TRIALS_DOMAIN=$(read_env_value "$PLATFORM_ENV_FILE" TRIALS_DOMAIN) || { echo 'Platform TRIALS_DOMAIN is missing.' >&2; exit 1; }
TRIALS_DB_PASSWORD=$(read_env_value "$ENV_FILE" TRIALS_DB_PASSWORD) || { echo 'TRIALS_DB_PASSWORD is missing.' >&2; exit 1; }
TRIALS_RUNTIME_DB_PASSWORD=$(read_env_value "$ENV_FILE" TRIALS_RUNTIME_DB_PASSWORD) || { echo 'TRIALS_RUNTIME_DB_PASSWORD is missing.' >&2; exit 1; }
PAYMENT_PROVIDER=$(read_env_value "$ENV_FILE" PAYMENT_PROVIDER 2>/dev/null || true)
ENABLE_TEST_INTEGRATIONS=$(read_env_value "$ENV_FILE" ENABLE_TEST_INTEGRATIONS 2>/dev/null || true)
PLATFORM_TRIALS_DB_PASSWORD=$(read_env_value "$PLATFORM_ENV_FILE" TRIALS_DB_PASSWORD) || { echo 'Platform TRIALS_DB_PASSWORD is missing.' >&2; exit 1; }
PLATFORM_TRIALS_RUNTIME_DB_PASSWORD=$(read_env_value "$PLATFORM_ENV_FILE" TRIALS_RUNTIME_DB_PASSWORD) || { echo 'Platform TRIALS_RUNTIME_DB_PASSWORD is missing.' >&2; exit 1; }
[[ -n "$TRIALS_DOMAIN" && "$TRIALS_DOMAIN" != *'://'* && "$TRIALS_DOMAIN" != *[[:space:]]* ]] || { echo 'TRIALS_DOMAIN must be a hostname without a scheme.' >&2; exit 1; }
[[ "$TRIALS_DOMAIN" == "$PLATFORM_TRIALS_DOMAIN" ]] || { echo 'Trials and platform domains do not match.' >&2; exit 1; }
[[ -n "$TRIALS_DB_PASSWORD" && -n "$TRIALS_RUNTIME_DB_PASSWORD" ]] || { echo 'Trials database passwords must not be empty.' >&2; exit 1; }
[[ "$TRIALS_DB_PASSWORD" =~ ^[[:xdigit:]]+$ && "$TRIALS_RUNTIME_DB_PASSWORD" =~ ^[[:xdigit:]]+$ ]] || { echo 'Trials database passwords must be hex-only.' >&2; exit 1; }
[[ "$TRIALS_DB_PASSWORD" != "$TRIALS_RUNTIME_DB_PASSWORD" ]] || { echo 'Migration and runtime database passwords must differ.' >&2; exit 1; }
if [[ "$ENABLE_TEST_INTEGRATIONS" == true ]]; then
  [[ "$PAYMENT_PROVIDER" == stripe ]] || { echo 'Enabled TEST integrations require PAYMENT_PROVIDER=stripe.' >&2; exit 1; }
  for key in INFISICAL_UNIVERSAL_AUTH_CLIENT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET INFISICAL_PROJECT_ID INFISICAL_ENVIRONMENT; do
    value=$(read_env_value "$ENV_FILE" "$key" 2>/dev/null || true)
    [[ -n "$value" ]] || { echo "Enabled TEST integrations require $key." >&2; exit 1; }
  done
  [[ $(read_env_value "$ENV_FILE" INFISICAL_ENVIRONMENT) == test ]] || { echo 'Hosted TEST integrations require INFISICAL_ENVIRONMENT=test.' >&2; exit 1; }
else
  [[ -z "$PAYMENT_PROVIDER" || "$PAYMENT_PROVIDER" == fake ]] || { echo 'Fake hosted TEST mode requires PAYMENT_PROVIDER=fake.' >&2; exit 1; }
fi
[[ "$TRIALS_DB_PASSWORD" == "$PLATFORM_TRIALS_DB_PASSWORD" && "$TRIALS_RUNTIME_DB_PASSWORD" == "$PLATFORM_TRIALS_RUNTIME_DB_PASSWORD" ]] || { echo 'Trials and platform database passwords do not match.' >&2; exit 1; }

COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.yaml)
PLATFORM_COMPOSE=(docker compose --env-file "$PLATFORM_ENV_FILE" -f "$PLATFORM_COMPOSE_FILE")
"${COMPOSE[@]}" config -q
"${PLATFORM_COMPOSE[@]}" config -q
docker network inspect netball_edge netball_trials_proxy netball_trials_db netball_trials_egress >/dev/null
[[ -n $("${PLATFORM_COMPOSE[@]}" ps -q db) ]] || { echo 'The platform database container is not running.' >&2; exit 1; }
[[ -n $("${PLATFORM_COMPOSE[@]}" ps -q edge) ]] || { echo 'The platform edge container is not running.' >&2; exit 1; }
"${PLATFORM_COMPOSE[@]}" exec -T db pg_isready -U netball_host_admin -d netballtrials_test >/dev/null

"${COMPOSE[@]}" --profile jobs build trials-api trials-web trials-migrate trials-reminders trials-retention

TIMERS_PAUSED=0
MUTATION_STARTED=0
restore_pre_mutation_timers() {
  if [[ "$TIMERS_PAUSED" == 1 && "$MUTATION_STARTED" == 0 ]]; then
    systemctl start netball-trials-reminders.timer netball-trials-retention.timer 2>/dev/null || true
  fi
}
trap restore_pre_mutation_timers EXIT
systemctl stop netball-trials-reminders.timer netball-trials-retention.timer 2>/dev/null || true
TIMERS_PAUSED=1
exec 9>/run/lock/netball-trials-operations.lock
flock -w 1800 9 || { echo 'Another Trials migration or job is still running.' >&2; exit 1; }

NETBALL_TRIALS_ENV_FILE="$ENV_FILE" NETBALL_PLATFORM_ENV_FILE="$PLATFORM_ENV_FILE" \
  NETBALL_PLATFORM_COMPOSE_FILE="$PLATFORM_COMPOSE_FILE" ./upgrade-trials-runtime-role.sh
"${COMPOSE[@]}" stop trials-api trials-web
MUTATION_STARTED=1
"${COMPOSE[@]}" --profile jobs run --rm trials-migrate
if ! "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 trials-api trials-web; then
  "${COMPOSE[@]}" ps trials-api trials-web >&2
  exit 1
fi

install -m 0644 \
  systemd/netball-trials-reminders.service systemd/netball-trials-reminders.timer \
  systemd/netball-trials-retention.service systemd/netball-trials-retention.timer \
  /etc/systemd/system/
systemctl daemon-reload
edge_headers=$("${PLATFORM_COMPOSE[@]}" exec -T edge wget -SO- --header="Host: $TRIALS_DOMAIN" http://127.0.0.1/api/health 2>&1 || true)
[[ "$edge_headers" == *' 308 '* ]] || { echo 'The edge is not routing the Trials hostname to HTTPS.' >&2; exit 1; }
health=$("${PLATFORM_COMPOSE[@]}" exec -T edge wget -qO- http://trials-web:8080/api/health 2>/dev/null || true)
[[ "$health" == *'"status":"ok"'* ]] || { echo 'The edge network cannot reach a healthy Trials API response.' >&2; exit 1; }
"${PLATFORM_COMPOSE[@]}" exec -T edge wget -qO- http://trials-web:8080/ >/dev/null 2>&1 || { echo 'The edge network cannot reach the Trials web site.' >&2; exit 1; }
systemctl enable --now netball-trials-reminders.timer netball-trials-retention.timer
TIMERS_PAUSED=0
for timer in netball-trials-reminders.timer netball-trials-retention.timer; do
  systemctl is-enabled --quiet "$timer"
  systemctl is-active --quiet "$timer"
done

echo 'Trials deployed; API and web are healthy and both timers are active.'
