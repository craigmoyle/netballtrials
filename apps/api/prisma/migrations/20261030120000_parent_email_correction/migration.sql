ALTER TYPE "ParentAccessTokenPurpose" ADD VALUE 'REGISTRATION_EMAIL_CHANGE';

ALTER TABLE "RegistrationChangeLog"
  ADD COLUMN "changeData" JSONB;
