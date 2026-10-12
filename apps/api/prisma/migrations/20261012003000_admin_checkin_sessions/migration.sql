-- Link Admin-created event check-in sessions to their parent Admin session.
ALTER TABLE "CheckInSession" ADD COLUMN "adminSessionId" TEXT;

CREATE INDEX "CheckInSession_adminSessionId_idx" ON "CheckInSession"("adminSessionId");

ALTER TABLE "CheckInSession"
  ADD CONSTRAINT "CheckInSession_adminSessionId_fkey"
  FOREIGN KEY ("adminSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
