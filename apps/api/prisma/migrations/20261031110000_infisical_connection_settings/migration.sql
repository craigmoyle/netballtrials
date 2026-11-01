CREATE TABLE "InfisicalConnectionSettings" (
  "id" TEXT NOT NULL DEFAULT 'infisical',
  "apiUrl" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "secretPath" TEXT NOT NULL DEFAULT '/',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InfisicalConnectionSettings_pkey" PRIMARY KEY ("id")
);
