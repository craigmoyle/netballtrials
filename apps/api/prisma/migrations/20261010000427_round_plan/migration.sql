-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "RoundPlan" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "rounds" INTEGER NOT NULL,
    "playMinutes" INTEGER NOT NULL,
    "changeoverMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "RoundPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundSlot" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "court" INTEGER NOT NULL,
    "position" "Position" NOT NULL,
    "team" INTEGER NOT NULL,
    "registrationId" TEXT NOT NULL,

    CONSTRAINT "RoundSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoundPlan_eventId_idx" ON "RoundPlan"("eventId");

-- CreateIndex
CREATE INDEX "RoundSlot_planId_round_idx" ON "RoundSlot"("planId", "round");

-- AddForeignKey
ALTER TABLE "RoundPlan" ADD CONSTRAINT "RoundPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundSlot" ADD CONSTRAINT "RoundSlot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RoundPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
