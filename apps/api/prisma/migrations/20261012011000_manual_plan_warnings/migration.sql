ALTER TABLE "RoundPlan"
  ADD COLUMN "validationWarnings" JSONB NOT NULL DEFAULT '[]';
