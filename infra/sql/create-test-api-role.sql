\set ON_ERROR_STOP on

-- Run as the PostgreSQL administrator. The database password is entered through
-- psql's hidden prompt so it is not stored in this file, shell history, or SQL text.
SELECT 'CREATE ROLE netballtrials_test_api'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'netballtrials_test_api')
\gexec

ALTER ROLE netballtrials_test_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password netballtrials_test_api
ALTER DATABASE netballtrials_test OWNER TO netballtrials_test_api;
\connect netballtrials_test
ALTER SCHEMA public OWNER TO netballtrials_test_api;
GRANT CONNECT, TEMPORARY ON DATABASE netballtrials_test TO netballtrials_test_api;
