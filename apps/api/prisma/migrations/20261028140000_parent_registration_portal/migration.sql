CREATE TYPE "ParentAccessTokenPurpose" AS ENUM ('REGISTRATION_VERIFY', 'SIGN_IN', 'EMAIL_CHANGE');

ALTER TABLE "Registration"
  ADD COLUMN "parentEmailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "parentFollowUpSentAt" TIMESTAMP(3);

CREATE INDEX "Registration_parentEmail_parentEmailVerifiedAt_idx"
  ON "Registration"("parentEmail", "parentEmailVerifiedAt");

CREATE TABLE "ParentAccessToken" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "newEmail" TEXT,
  "purpose" "ParentAccessTokenPurpose" NOT NULL,
  "registrationId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentAccessToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParentAccessToken_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ParentAccessToken_tokenHash_key" ON "ParentAccessToken"("tokenHash");
CREATE INDEX "ParentAccessToken_email_purpose_expiresAt_idx" ON "ParentAccessToken"("email", "purpose", "expiresAt");
CREATE INDEX "ParentAccessToken_registrationId_idx" ON "ParentAccessToken"("registrationId");

CREATE TABLE "ParentAccessSession" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentAccessSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParentAccessSession_tokenHash_key" ON "ParentAccessSession"("tokenHash");
CREATE INDEX "ParentAccessSession_email_expiresAt_idx" ON "ParentAccessSession"("email", "expiresAt");

CREATE TABLE "RegistrationChangeLog" (
  "id" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "actorType" TEXT NOT NULL DEFAULT 'PARENT',
  "changedFields" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegistrationChangeLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RegistrationChangeLog_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RegistrationChangeLog_registrationId_createdAt_idx" ON "RegistrationChangeLog"("registrationId", "createdAt");
