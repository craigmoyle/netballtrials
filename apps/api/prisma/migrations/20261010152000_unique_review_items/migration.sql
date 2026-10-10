ALTER TABLE "ReviewItem" ADD COLUMN "resolutionHistory" JSONB;

-- Keep one row for each flagged registration/reason and archive all prior notes and resolver provenance.
WITH ranked AS (
  SELECT
    "id", "registrationId", "reason",
    row_number() OVER (
      PARTITION BY "registrationId", "reason"
      ORDER BY ("resolvedAt" IS NULL) DESC, "createdAt" ASC, "id" ASC
    ) AS position
  FROM "ReviewItem"
), histories AS (
  SELECT
    "registrationId", "reason",
    jsonb_agg(
      jsonb_build_object(
        'id', "id",
        'note', "note",
        'resolvedAt', "resolvedAt",
        'resolvedByUserId', "resolvedByUserId",
        'createdAt', "createdAt"
      ) ORDER BY ("resolvedAt" IS NULL) DESC, "createdAt" ASC, "id" ASC
    ) AS history
  FROM "ReviewItem"
  GROUP BY "registrationId", "reason"
  HAVING count(*) > 1
)
UPDATE "ReviewItem" AS keeper
SET "resolutionHistory" = histories.history
FROM ranked
JOIN histories
  ON histories."registrationId" = ranked."registrationId"
 AND histories."reason" = ranked."reason"
WHERE ranked.position = 1
  AND keeper."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "registrationId", "reason"
      ORDER BY ("resolvedAt" IS NULL) DESC, "createdAt" ASC, "id" ASC
    ) AS position
  FROM "ReviewItem"
)
DELETE FROM "ReviewItem" AS duplicate
USING ranked
WHERE duplicate."id" = ranked."id"
  AND ranked.position > 1;

CREATE UNIQUE INDEX "ReviewItem_registrationId_reason_key"
ON "ReviewItem"("registrationId", "reason");
