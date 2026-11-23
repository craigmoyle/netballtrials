#!/usr/bin/env bash
set -euo pipefail

: "${STATS_DB_OWNER_PASSWORD:?required}"
: "${STATS_API_DB_PASSWORD:?required}"
: "${TRIALS_DB_PASSWORD:?required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=stats_owner_password="$STATS_DB_OWNER_PASSWORD" \
  --set=stats_api_password="$STATS_API_DB_PASSWORD" \
  --set=trials_password="$TRIALS_DB_PASSWORD" <<'SQL'
CREATE ROLE netballstats_owner LOGIN PASSWORD :'stats_owner_password';
CREATE ROLE netballstats_api LOGIN PASSWORD :'stats_api_password';
CREATE ROLE netballtrials_app LOGIN PASSWORD :'trials_password';
CREATE DATABASE netballstats OWNER netballstats_owner;
CREATE DATABASE netballtrials_test OWNER netballtrials_app;
REVOKE CONNECT ON DATABASE netballstats FROM PUBLIC;
REVOKE CONNECT ON DATABASE netballtrials_test FROM PUBLIC;
GRANT CONNECT ON DATABASE netballstats TO netballstats_owner, netballstats_api;
GRANT CONNECT ON DATABASE netballtrials_test TO netballtrials_app;

\connect netballstats
CREATE EXTENSION pgaudit;
CREATE EXTENSION pg_trgm;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO netballstats_owner;
GRANT USAGE ON SCHEMA public TO netballstats_api;
ALTER DEFAULT PRIVILEGES FOR ROLE netballstats_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO netballstats_api;

\connect netballtrials_test
CREATE EXTENSION pgaudit;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO netballtrials_app;
SQL
