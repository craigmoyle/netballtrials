ALTER TABLE "TestEmailOutbox"
ADD COLUMN "attachmentMetadata" JSONB,
ADD COLUMN "inlineImageMetadata" JSONB;
