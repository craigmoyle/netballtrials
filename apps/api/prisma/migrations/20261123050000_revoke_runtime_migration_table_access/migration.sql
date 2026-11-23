DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'netballtrials_runtime') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."_prisma_migrations" FROM netballtrials_runtime';
  END IF;
END
$$;
