#!/usr/bin/env bash
set -euo pipefail

: "${STATS_DB_OWNER_PASSWORD:?required}"
: "${STATS_API_DB_PASSWORD:?required}"
: "${TRIALS_DB_PASSWORD:?required}"
: "${TRIALS_RUNTIME_DB_PASSWORD:?required}"
[[ "$TRIALS_DB_PASSWORD" != "$TRIALS_RUNTIME_DB_PASSWORD" ]] || { echo 'Trials migration and runtime passwords must differ.' >&2; exit 1; }

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=stats_owner_password="$STATS_DB_OWNER_PASSWORD" \
  --set=stats_api_password="$STATS_API_DB_PASSWORD" \
  --set=trials_password="$TRIALS_DB_PASSWORD" \
  --set=trials_runtime_password="$TRIALS_RUNTIME_DB_PASSWORD" <<'SQL'
CREATE ROLE netballstats_owner LOGIN PASSWORD :'stats_owner_password';
CREATE ROLE netballstats_api LOGIN PASSWORD :'stats_api_password';
CREATE ROLE netballtrials_app LOGIN PASSWORD :'trials_password';
CREATE ROLE netballtrials_runtime LOGIN PASSWORD :'trials_runtime_password';
CREATE DATABASE netballstats OWNER netballstats_owner;
CREATE DATABASE netballtrials_test OWNER netballtrials_app;
REVOKE CONNECT ON DATABASE netballstats FROM PUBLIC;
REVOKE ALL ON DATABASE netballtrials_test FROM PUBLIC;
GRANT CONNECT ON DATABASE netballstats TO netballstats_owner, netballstats_api;
GRANT CONNECT ON DATABASE netballtrials_test TO netballtrials_app, netballtrials_runtime;

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
GRANT USAGE ON SCHEMA public TO netballtrials_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO netballtrials_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO netballtrials_runtime;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE n.nspname = 'public' AND t.typtype IN ('d', 'e', 'c')
  LOOP EXECUTE format('GRANT USAGE ON TYPE public.%I TO netballtrials_runtime', item.typname); END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE netballtrials_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO netballtrials_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE netballtrials_app IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO netballtrials_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE netballtrials_app IN SCHEMA public
  GRANT USAGE ON TYPES TO netballtrials_runtime;
SQL
