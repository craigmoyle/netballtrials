-- AlterTable
ALTER TABLE "Registration" ADD COLUMN "anonymizedAt" TIMESTAMP(3),
ADD COLUMN "anonymizedRef" TEXT,
ADD COLUMN "statusBeforeAnonymization" "RegistrationStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Registration_anonymizedRef_key" ON "Registration"("anonymizedRef");
