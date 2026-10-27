ALTER TABLE "MemberAssociation"
ADD COLUMN "primaryContactName" TEXT,
ADD COLUMN "primaryContactEmail" TEXT;

ALTER TABLE "EmailLog" ADD COLUMN "associationId" TEXT;
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_associationId_fkey"
FOREIGN KEY ("associationId") REFERENCES "MemberAssociation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "ScheduledMessageStatus" AS ENUM ('SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "templateId" TEXT,
    "audience" TEXT NOT NULL,
    "recipientIds" JSONB NOT NULL,
    "batchId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "policyAttachment" JSONB,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailTemplate_name_key" ON "EmailTemplate"("name");
CREATE UNIQUE INDEX "ScheduledMessage_batchId_key" ON "ScheduledMessage"("batchId");
CREATE INDEX "ScheduledMessage_status_scheduledAt_idx" ON "ScheduledMessage"("status", "scheduledAt");
CREATE INDEX "ScheduledMessage_eventId_scheduledAt_idx" ON "ScheduledMessage"("eventId", "scheduledAt");

ALTER TABLE "ScheduledMessage"
ADD CONSTRAINT "ScheduledMessage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "ScheduledMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "ScheduledMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
