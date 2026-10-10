CREATE TABLE "RequestRateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "hits" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestRateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RequestRateLimitBucket_updatedAt_idx" ON "RequestRateLimitBucket"("updatedAt");
