CREATE TABLE "SiteAssociationCommunication" (
  "id" TEXT NOT NULL,
  "anchorEventId" TEXT NOT NULL,
  "eventIds" JSONB NOT NULL,
  "recipientIds" JSONB NOT NULL,
  "eventList" TEXT NOT NULL,
  "senderUserId" TEXT,
  "templateId" TEXT,
  "batchId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'SENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteAssociationCommunication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteAssociationCommunication_batchId_key" ON "SiteAssociationCommunication"("batchId");
CREATE INDEX "SiteAssociationCommunication_status_scheduledAt_idx" ON "SiteAssociationCommunication"("status", "scheduledAt");
CREATE INDEX "SiteAssociationCommunication_anchorEventId_scheduledAt_idx" ON "SiteAssociationCommunication"("anchorEventId", "scheduledAt");

ALTER TABLE "SiteAssociationCommunication"
  ADD CONSTRAINT "SiteAssociationCommunication_anchorEventId_fkey"
  FOREIGN KEY ("anchorEventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteAssociationCommunication"
  ADD CONSTRAINT "SiteAssociationCommunication_senderUserId_fkey"
  FOREIGN KEY ("senderUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SiteAssociationCommunication"
  ADD CONSTRAINT "SiteAssociationCommunication_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailLog" ADD COLUMN "siteCommunicationId" TEXT;
CREATE INDEX "EmailLog_siteCommunicationId_idx" ON "EmailLog"("siteCommunicationId");
ALTER TABLE "EmailLog"
  ADD CONSTRAINT "EmailLog_siteCommunicationId_fkey"
  FOREIGN KEY ("siteCommunicationId") REFERENCES "SiteAssociationCommunication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
