-- The DUPLICATE enum is added in the preceding migration so PostgreSQL can commit it before use.

-- Add the required deadline with a temporary current-time default so unrelated event callers remain valid.
ALTER TABLE "Event"
ADD COLUMN "registrationClosesAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "registrationClosedAt" TIMESTAMP(3);

-- Reconstruct the legacy deadline from the Melbourne wall-clock event time.
UPDATE "Event"
SET "registrationClosesAt" =
  (("eventDate"::timestamp + "startTime"::time) AT TIME ZONE 'Australia/Melbourne') - INTERVAL '24 hours';

ALTER TABLE "Event" ALTER COLUMN "registrationClosesAt" DROP DEFAULT;

-- Policy snapshots intentionally copy the effective event configuration rather than linking mutable settings.
CREATE TABLE "EventPolicySnapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "policyReference" TEXT NOT NULL,
    "competitionYear" INTEGER NOT NULL,
    "minAge" INTEGER NOT NULL,
    "maxAge" INTEGER NOT NULL,
    "policyUrl" TEXT,
    "policyDocumentName" TEXT,
    "policyDocumentBytes" BYTEA,
    "policyDocumentHash" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPolicySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventPolicySnapshot_eventId_version_key" ON "EventPolicySnapshot"("eventId", "version");
CREATE INDEX "EventPolicySnapshot_eventId_idx" ON "EventPolicySnapshot"("eventId");
ALTER TABLE "EventPolicySnapshot" ADD CONSTRAINT "EventPolicySnapshot_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "EventPolicySnapshot" (
  "id", "eventId", "version", "policyReference", "competitionYear", "minAge", "maxAge",
  "policyUrl", "policyDocumentName", "policyDocumentBytes", "policyDocumentHash", "capturedAt"
)
SELECT
  md5('legacy-policy:' || event.id),
  event.id,
  1,
  COALESCE(first_registration."policyReference", event."policyUrl", ''),
  event."competitionYear",
  event."minAge",
  event."maxAge",
  event."policyUrl",
  event."policyDocumentName",
  policy_document."bytes",
  CASE WHEN policy_document."bytes" IS NULL THEN NULL ELSE encode(sha256(policy_document."bytes"), 'hex') END,
  event."createdAt"
FROM "Event" AS event
LEFT JOIN "EventPolicyDocument" AS policy_document ON policy_document."eventId" = event.id
LEFT JOIN LATERAL (
  SELECT registration."policyReference"
  FROM "Registration" AS registration
  WHERE registration."eventId" = event.id
  ORDER BY registration."createdAt", registration.id
  LIMIT 1
) AS first_registration ON TRUE
WHERE event.status <> 'DRAFT'
ON CONFLICT ("eventId", "version") DO NOTHING;

ALTER TABLE "Registration"
ADD COLUMN "policySnapshotId" TEXT,
ADD COLUMN "checkoutAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "adminAssistedAt" TIMESTAMP(3),
ADD COLUMN "duplicateOfRegistrationId" TEXT,
ADD COLUMN "removedAt" TIMESTAMP(3),
ADD COLUMN "removalReason" TEXT,
ADD COLUMN "removalNote" TEXT;

-- Every existing registration keeps its effective legacy policy, including ineligible rows.
UPDATE "Registration" AS registration
SET "policySnapshotId" = snapshot.id
FROM "EventPolicySnapshot" AS snapshot
WHERE snapshot."eventId" = registration."eventId"
  AND snapshot."version" = 1
  AND registration."policySnapshotId" IS NULL;

CREATE INDEX "Registration_policySnapshotId_idx" ON "Registration"("policySnapshotId");
CREATE INDEX "Registration_duplicateOfRegistrationId_idx" ON "Registration"("duplicateOfRegistrationId");
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_duplicate_not_self_check"
CHECK ("duplicateOfRegistrationId" IS NULL OR "duplicateOfRegistrationId" <> "id");
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_removalReason_check"
CHECK ("removalReason" IS NULL OR "removalReason" IN (
  'Duplicate', 'Unable to attend', 'Late withdrawal', 'Ineligible correction', 'Did not arrive', 'Other'
));
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_other_removal_note_check"
CHECK ("removalReason" IS DISTINCT FROM 'Other' OR NULLIF(BTRIM("removalNote"), '') IS NOT NULL);
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_duplicate_removal_check"
CHECK (
  ("duplicateOfRegistrationId" IS NULL AND "status" <> 'DUPLICATE')
  OR
  ("duplicateOfRegistrationId" IS NOT NULL AND "status" = 'DUPLICATE'
    AND "removalReason" = 'Duplicate' AND "removedAt" IS NOT NULL)
);
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_policySnapshotId_fkey"
FOREIGN KEY ("policySnapshotId") REFERENCES "EventPolicySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_duplicateOfRegistrationId_fkey"
FOREIGN KEY ("duplicateOfRegistrationId") REFERENCES "Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only a legacy check-in close has enough evidence to reconstruct a final roster.
CREATE TABLE "RosterSnapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RosterSnapshot_eventId_revision_key" ON "RosterSnapshot"("eventId", "revision");
CREATE INDEX "RosterSnapshot_eventId_idx" ON "RosterSnapshot"("eventId");
ALTER TABLE "RosterSnapshot" ADD CONSTRAINT "RosterSnapshot_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "RosterSnapshot" ("id", "eventId", "revision", "reconstructed", "data", "createdAt")
SELECT
  md5('legacy-roster:' || event.id || ':1'),
  event.id,
  1,
  true,
  jsonb_build_object(
    'reconstructed', true,
    'label', 'Reconstructed from closed check-in',
    'registrations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', registration.id,
          'playerFirstName', registration."playerFirstName",
          'playerLastName', registration."playerLastName",
          'memberAssociation', registration."memberAssociation",
          'rank1Position', registration."rank1Position",
          'rank2Position', registration."rank2Position",
          'rank3Position', registration."rank3Position",
          'bibNumber', registration."bibNumber",
          'status', registration.status,
          'checkedInAt', registration."checkedInAt"
        ) ORDER BY registration."bibNumber" NULLS LAST, registration.id
      )
      FROM "Registration" AS registration
      WHERE registration."eventId" = event.id
        AND registration.status = 'PAID'
        AND registration."checkedInAt" IS NOT NULL
        AND registration."anonymizedAt" IS NULL
    ), '[]'::jsonb)
  ),
  event."checkInClosedAt"
FROM "Event" AS event
WHERE event."checkInClosedAt" IS NOT NULL
ON CONFLICT ("eventId", "revision") DO NOTHING;

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorUserId" TEXT,
    "actorEmailSnapshot" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_eventId_createdAt_idx" ON "AuditEvent"("eventId", "createdAt");
CREATE INDEX "AuditEvent_registrationId_idx" ON "AuditEvent"("registrationId");
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_registrationId_fkey"
FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION "AuditEvent_capture_actor_email"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."actorUserId" IS NOT NULL THEN
    SELECT staff.email INTO NEW."actorEmailSnapshot"
    FROM "StaffUser" AS staff
    WHERE staff.id = NEW."actorUserId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_capture_actor_email_trigger"
BEFORE INSERT OR UPDATE OF "actorUserId" ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "AuditEvent_capture_actor_email"();

ALTER TABLE "ReviewItem"
ADD COLUMN "emailLogId" TEXT,
ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "ReviewItem_dedupeKey_key" ON "ReviewItem"("dedupeKey");
CREATE INDEX "ReviewItem_emailLogId_idx" ON "ReviewItem"("emailLogId");
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_emailLogId_fkey"
FOREIGN KEY ("emailLogId") REFERENCES "EmailLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
