CREATE TYPE "EmailDeliveryState" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'AMBIGUOUS');

ALTER TABLE "EmailLog"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "batchId" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "senderUserId" TEXT,
  ADD COLUMN "status" "EmailDeliveryState" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "sentAt" DROP NOT NULL,
  ALTER COLUMN "sentAt" DROP DEFAULT;

UPDATE "EmailLog"
SET "batchId" = 'legacy-' || "id",
    "idempotencyKey" = 'legacy-' || "id",
    "status" = CASE WHEN "failedAt" IS NULL THEN 'SENT'::"EmailDeliveryState" ELSE 'FAILED'::"EmailDeliveryState" END,
    "createdAt" = COALESCE("sentAt", "failedAt", CURRENT_TIMESTAMP),
    "updatedAt" = COALESCE("sentAt", "failedAt", CURRENT_TIMESTAMP);

ALTER TABLE "EmailLog"
  ALTER COLUMN "batchId" SET NOT NULL,
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

DROP INDEX IF EXISTS "EmailLog_eventId_idx";
CREATE UNIQUE INDEX "EmailLog_idempotencyKey_key" ON "EmailLog"("idempotencyKey");
CREATE INDEX "EmailLog_eventId_sentAt_idx" ON "EmailLog"("eventId", "sentAt");
CREATE INDEX "EmailLog_batchId_status_idx" ON "EmailLog"("batchId", "status");
ALTER TABLE "EmailLog"
  ADD CONSTRAINT "EmailLog_senderUserId_fkey"
  FOREIGN KEY ("senderUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

