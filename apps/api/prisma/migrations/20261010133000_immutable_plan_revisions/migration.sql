ALTER TABLE "Event" ADD COLUMN "publishedPlanId" TEXT;

ALTER TABLE "RoundPlan"
  ADD COLUMN "courts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "eventDate" DATE NOT NULL DEFAULT '1900-01-01',
  ADD COLUMN "eventName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "firstWhistle" TEXT NOT NULL DEFAULT '00:00',
  ADD COLUMN "frozenThroughRound" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rank1Min" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rank2Min" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rank3Min" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revision" INTEGER,
  ADD COLUMN "sourcePlanId" TEXT,
  ADD COLUMN "venue" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "windowMinutes" INTEGER NOT NULL DEFAULT 1;

WITH numbered AS (
  SELECT rp."id", row_number() OVER (PARTITION BY rp."eventId" ORDER BY rp."createdAt", rp."id") AS revision
  FROM "RoundPlan" rp
)
UPDATE "RoundPlan" rp
SET "revision" = numbered.revision
FROM numbered
WHERE rp."id" = numbered."id";

ALTER TABLE "RoundPlan" ALTER COLUMN "revision" SET NOT NULL;
ALTER TABLE "RoundPlan" ALTER COLUMN "revision" SET DEFAULT 1;

UPDATE "RoundPlan" rp
SET "courts" = e."courts",
    "playMinutes" = e."playMinutes",
    "changeoverMinutes" = e."changeoverMinutes",
    "rank1Min" = e."rank1Min",
    "rank2Min" = e."rank2Min",
    "rank3Min" = e."rank3Min",
    "eventName" = e."name",
    "eventDate" = e."eventDate",
    "venue" = e."venue",
    "firstWhistle" = e."firstWhistle",
    "windowMinutes" = GREATEST(1,
      ((split_part(e."lastWhistle", ':', 1)::int * 60 + split_part(e."lastWhistle", ':', 2)::int)
      - (split_part(e."firstWhistle", ':', 1)::int * 60 + split_part(e."firstWhistle", ':', 2)::int)))
FROM "Event" e
WHERE e."id" = rp."eventId";

CREATE TABLE "RoundPlanPlayer" (
  "planId" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "playerName" TEXT NOT NULL,
  "bibNumber" INTEGER,
  "rank1Position" "Position" NOT NULL,
  "rank2Position" "Position",
  "rank3Position" "Position",
  "optInExtraPositions" BOOLEAN NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "RoundPlanPlayer_pkey" PRIMARY KEY ("planId", "registrationId"),
  CONSTRAINT "RoundPlanPlayer_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RoundPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "RoundPlanPlayer" (
  "planId", "registrationId", "playerName", "bibNumber", "rank1Position", "rank2Position",
  "rank3Position", "optInExtraPositions", "active"
)
SELECT DISTINCT ON (s."planId", s."registrationId")
  s."planId",
  s."registrationId",
  CASE WHEN r."id" IS NULL THEN 'Former participant'
       ELSE trim(concat(r."playerFirstName", ' ', r."playerLastName")) END,
  r."bibNumber",
  COALESCE(r."rank1Position", s."position"),
  r."rank2Position",
  r."rank3Position",
  COALESCE(r."optInExtraPositions", true),
  COALESCE(r."status" = 'PAID' AND r."checkedInAt" IS NOT NULL, false)
FROM "RoundSlot" s
LEFT JOIN "Registration" r ON r."id" = s."registrationId"
ORDER BY s."planId", s."registrationId", s."round", s."court", s."position";

UPDATE "Event" e
SET "publishedPlanId" = (
  SELECT rp."id" FROM "RoundPlan" rp
  WHERE rp."eventId" = e."id" AND rp."status" = 'PUBLISHED'
  ORDER BY rp."revision" DESC
  LIMIT 1
);

CREATE UNIQUE INDEX "RoundPlan_eventId_revision_key" ON "RoundPlan"("eventId", "revision");
CREATE INDEX "RoundPlanPlayer_registrationId_idx" ON "RoundPlanPlayer"("registrationId");
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_publishedPlanId_fkey" FOREIGN KEY ("publishedPlanId") REFERENCES "RoundPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
