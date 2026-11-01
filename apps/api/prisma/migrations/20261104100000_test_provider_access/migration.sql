ALTER TABLE "EmailLog" ADD COLUMN "simulated" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TestEmailOutbox" (
  "id" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "html" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TestEmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TestEmailOutbox_expiresAt_idx" ON "TestEmailOutbox"("expiresAt");
