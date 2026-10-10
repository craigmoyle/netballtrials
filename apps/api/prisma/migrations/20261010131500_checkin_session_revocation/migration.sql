-- Existing volunteer sessions were created before they carried a PIN version.
-- Revoke them on deploy so prior cookies cannot bypass the new revocation checks.
DELETE FROM "CheckInSession";

ALTER TABLE "CheckInSession"
  ADD COLUMN "pinVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Event"
  ADD COLUMN "checkInPinVersion" INTEGER NOT NULL DEFAULT 0;
