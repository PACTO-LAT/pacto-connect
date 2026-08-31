-- CreateEnum
CREATE TYPE "RiskListType" AS ENUM ('allow', 'deny');

-- CreateEnum
CREATE TYPE "RiskDecisionOutcome" AS ENUM ('allow', 'review', 'block');

-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN "counterpartyRef" TEXT;

-- CreateTable
CREATE TABLE "MerchantRiskSettings" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "windowMs" INTEGER,
    "valueThreshold" DOUBLE PRECISION,
    "countThreshold" INTEGER,
    "reviewValueThreshold" DOUBLE PRECISION,
    "reviewCountThreshold" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantRiskSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantRiskListEntry" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "listType" "RiskListType" NOT NULL,
    "counterpartyRef" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantRiskListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskDecision" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "counterpartyRef" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "asset" TEXT NOT NULL,
    "outcome" "RiskDecisionOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantRiskSettings_merchantId_key" ON "MerchantRiskSettings"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantRiskSettings_merchantId_idx" ON "MerchantRiskSettings"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantRiskListEntry_merchantId_idx" ON "MerchantRiskListEntry"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantRiskListEntry_merchantId_listType_idx" ON "MerchantRiskListEntry"("merchantId", "listType");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantRiskListEntry_merchantId_listType_counterpartyRef_key" ON "MerchantRiskListEntry"("merchantId", "listType", "counterpartyRef");

-- CreateIndex
CREATE INDEX "RiskDecision_merchantId_createdAt_idx" ON "RiskDecision"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskDecision_merchantId_outcome_idx" ON "RiskDecision"("merchantId", "outcome");

-- AddForeignKey
ALTER TABLE "MerchantRiskSettings" ADD CONSTRAINT "MerchantRiskSettings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRiskListEntry" ADD CONSTRAINT "MerchantRiskListEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskDecision" ADD CONSTRAINT "RiskDecision_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
