ALTER TABLE "scratchpad_items"
  ADD COLUMN "commitment" JSONB,
  ADD COLUMN "reviewAt" TIMESTAMP(3),
  ADD COLUMN "reviewCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReviewAt" TIMESTAMP(3),
  ADD COLUMN "reviewRunId" TEXT;
CREATE INDEX "scratchpad_items_status_reviewAt_idx" ON "scratchpad_items"("status", "reviewAt");
