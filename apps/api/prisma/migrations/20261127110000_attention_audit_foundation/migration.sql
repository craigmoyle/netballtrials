ALTER TABLE "AuditEvent" ALTER COLUMN "eventId" DROP NOT NULL;

ALTER TABLE "ReviewItem" ALTER COLUMN "registrationId" DROP NOT NULL;
ALTER TABLE "ReviewItem" DROP CONSTRAINT "ReviewItem_registrationId_fkey";
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_registrationId_fkey"
FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "ReviewItem_registrationId_reason_key";
CREATE UNIQUE INDEX "ReviewItem_registrationId_reason_key"
ON "ReviewItem"("registrationId", "reason")
WHERE "registrationId" IS NOT NULL;
