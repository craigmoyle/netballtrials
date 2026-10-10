-- Split the checkout session from the eventual PaymentIntent. Preserve the old
-- reference for audit because previous versions stored both kinds in one field.
ALTER TABLE "Registration"
  ADD COLUMN "checkoutSessionId" TEXT,
  ADD COLUMN "legacyPaymentRef" TEXT,
  ADD COLUMN "paymentIntentId" TEXT;

UPDATE "Registration"
SET "legacyPaymentRef" = "paymentRef",
    "checkoutSessionId" = CASE
      WHEN "status" = 'PENDING' THEN "paymentRef"
      ELSE NULL
    END,
    "paymentIntentId" = CASE
      WHEN "status" = 'PAID' AND left("paymentRef", 3) = 'pi_' THEN "paymentRef"
      ELSE NULL
    END
WHERE "paymentRef" IS NOT NULL;

ALTER TABLE "Registration" DROP COLUMN "paymentRef";

CREATE TABLE "ProcessedStripeEvent" (
  "stripeEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("stripeEventId")
);

CREATE INDEX "ProcessedStripeEvent_createdAt_idx" ON "ProcessedStripeEvent"("createdAt");
CREATE UNIQUE INDEX "Registration_checkoutSessionId_key" ON "Registration"("checkoutSessionId");
CREATE UNIQUE INDEX "Registration_paymentIntentId_key" ON "Registration"("paymentIntentId");
