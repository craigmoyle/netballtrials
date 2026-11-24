ALTER TABLE "EmailLog" ADD COLUMN "registrationIds" JSONB;

WITH address_membership AS (
  SELECT "eventId" AS event_id, lower("parentEmail") AS email, id AS registration_id
  FROM "Registration"
  WHERE "anonymizedAt" IS NULL AND "parentEmail" <> ''
  UNION ALL
  SELECT registration."eventId" AS event_id, lower(address.value) AS email, registration.id AS registration_id
  FROM "RegistrationChangeLog" AS change
  JOIN "Registration" AS registration ON registration.id = change."registrationId"
  CROSS JOIN LATERAL (
    VALUES
      (change."changeData"->'parentEmail'->>'from'),
      (change."changeData"->'parentEmail'->>'to')
  ) AS address(value)
  WHERE registration."anonymizedAt" IS NULL AND address.value IS NOT NULL AND address.value <> ''
),
cohort AS (
  SELECT event_id, email, jsonb_agg(DISTINCT registration_id ORDER BY registration_id) AS ids
  FROM address_membership
  GROUP BY event_id, email
)
UPDATE "EmailLog" AS delivery
SET "registrationIds" = cohort.ids
FROM cohort
WHERE delivery."kind" IN ('message', 'reminder')
  AND delivery."registrationId" IS NOT NULL
  AND cohort.event_id = delivery."eventId"
  AND cohort.email = lower(delivery."to");
