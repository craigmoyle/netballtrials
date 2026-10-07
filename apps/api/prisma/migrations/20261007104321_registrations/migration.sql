-- CreateEnum
CREATE TYPE "Position" AS ENUM ('GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "maxAge" INTEGER NOT NULL DEFAULT 99,
ADD COLUMN     "minAge" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "playerFirstName" TEXT NOT NULL,
    "playerLastName" TEXT NOT NULL,
    "playerNameNormalized" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "parentName" TEXT NOT NULL,
    "parentEmail" TEXT NOT NULL,
    "parentMobile" TEXT NOT NULL,
    "memberAssociation" TEXT NOT NULL,
    "rank1Position" "Position" NOT NULL,
    "rank2Position" "Position",
    "rank3Position" "Position",
    "optInExtraPositions" BOOLEAN NOT NULL DEFAULT false,
    "eligibilityConfirmedAt" TIMESTAMP(3) NOT NULL,
    "policyReference" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "ageFlagged" BOOLEAN NOT NULL DEFAULT false,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'aud',
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "qrToken" TEXT,
    "bibNumber" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Registration_qrToken_key" ON "Registration"("qrToken");

-- CreateIndex
CREATE INDEX "Registration_eventId_status_idx" ON "Registration"("eventId", "status");

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Registration_active_player_unique"
  ON "Registration" ("eventId", "playerNameNormalized", "dateOfBirth")
  WHERE status IN ('PENDING', 'PAID');
