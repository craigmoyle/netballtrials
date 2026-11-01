CREATE TABLE "AutomaticEmailSettings" (
  "id" TEXT NOT NULL DEFAULT 'automatic',
  "confirmationSubject" TEXT NOT NULL,
  "confirmationBody" TEXT NOT NULL,
  "reminderSubject" TEXT NOT NULL,
  "reminderBody" TEXT NOT NULL,
  "reminderLeadHours" INTEGER NOT NULL DEFAULT 24,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomaticEmailSettings_pkey" PRIMARY KEY ("id")
);
