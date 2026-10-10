-- Constraints prevent new slots from occupying the same place twice or
-- assigning one registration to multiple courts in one round. Existing rows are
-- not rewritten; if legacy data violates uniqueness, creation fails and requires
-- an explicit audited repair. IF NOT EXISTS makes a partial retry safe.
CREATE UNIQUE INDEX IF NOT EXISTS "RoundSlot_planId_round_court_position_team_key"
  ON "RoundSlot"("planId", "round", "court", "position", "team");

CREATE UNIQUE INDEX IF NOT EXISTS "RoundSlot_planId_round_registrationId_key"
  ON "RoundSlot"("planId", "round", "registrationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoundSlot_round_positive_check') THEN
    ALTER TABLE "RoundSlot" ADD CONSTRAINT "RoundSlot_round_positive_check" CHECK ("round" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoundSlot_court_positive_check') THEN
    ALTER TABLE "RoundSlot" ADD CONSTRAINT "RoundSlot_court_positive_check" CHECK ("court" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoundSlot_team_range_check') THEN
    ALTER TABLE "RoundSlot" ADD CONSTRAINT "RoundSlot_team_range_check" CHECK ("team" IN (0, 1));
  END IF;
END $$;
