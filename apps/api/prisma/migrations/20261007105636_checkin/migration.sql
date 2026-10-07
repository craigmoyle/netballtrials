-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "checkInClosedAt" TIMESTAMP(3),
ADD COLUMN     "checkInPinHash" TEXT,
ADD COLUMN     "checkInPinUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "nextBibNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "checkedInBy" TEXT;

-- CreateTable
CREATE TABLE "CheckInSession" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckInSession_tokenHash_key" ON "CheckInSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CheckInSession_eventId_idx" ON "CheckInSession"("eventId");

-- AddForeignKey
ALTER TABLE "CheckInSession" ADD CONSTRAINT "CheckInSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
