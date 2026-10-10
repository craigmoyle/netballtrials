ALTER TABLE "StaffUser" ADD COLUMN "invitedByUserId" TEXT;

CREATE TABLE "EventPolicyDocument" (
  "eventId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventPolicyDocument_pkey" PRIMARY KEY ("eventId")
);

ALTER TABLE "StaffUser"
  ADD CONSTRAINT "StaffUser_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventPolicyDocument"
  ADD CONSTRAINT "EventPolicyDocument_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
