\set ON_ERROR_STOP on
\getenv runtime_password TRIALS_RUNTIME_DB_PASSWORD

SELECT format('CREATE ROLE netballtrials_runtime LOGIN PASSWORD %L', :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'netballtrials_runtime')
\gexec
ALTER ROLE netballtrials_runtime LOGIN PASSWORD :'runtime_password';
REVOKE ALL ON DATABASE netballtrials_test FROM PUBLIC;
GRANT CONNECT ON DATABASE netballtrials_test TO netballtrials_app, netballtrials_runtime;

\connect netballtrials_test
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO netballtrials_runtime;
REVOKE CREATE ON SCHEMA public FROM netballtrials_runtime;
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
DO $$ BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public."_prisma_migrations" FROM netballtrials_runtime';
  END IF;
END $$;
