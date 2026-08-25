-- CreateEnum
CREATE TYPE "SettlementPeriodStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "LedgerEntryKind" AS ENUM ('settlement', 'correction');

-- CreateEnum
CREATE TYPE "PayoutRunStatus" AS ENUM ('open', 'finalized');

-- CreateTable
CREATE TABLE "SettlementPeriod" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "SettlementPeriodStatus" NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRun" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "status" "PayoutRunStatus" NOT NULL DEFAULT 'open',
    "total" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "sourceEscrowId" TEXT,
    "direction" "LedgerDirection" NOT NULL,
    "kind" "LedgerEntryKind" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "asset" TEXT NOT NULL,
    "correctsEntryId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payoutRunId" TEXT,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementPeriod_merchantId_idx" ON "SettlementPeriod"("merchantId");

-- CreateIndex
CREATE INDEX "SettlementPeriod_status_idx" ON "SettlementPeriod"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementPeriod_merchantId_periodKey_key" ON "SettlementPeriod"("merchantId", "periodKey");

-- CreateIndex
CREATE INDEX "PayoutRun_merchantId_idx" ON "PayoutRun"("merchantId");

-- CreateIndex
CREATE INDEX "PayoutRun_periodId_idx" ON "PayoutRun"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRun_merchantId_periodId_asset_key" ON "PayoutRun"("merchantId", "periodId", "asset");

-- CreateIndex
CREATE INDEX "LedgerEntry_merchantId_idx" ON "LedgerEntry"("merchantId");

-- CreateIndex
CREATE INDEX "LedgerEntry_periodId_idx" ON "LedgerEntry"("periodId");

-- CreateIndex
CREATE INDEX "LedgerEntry_merchantId_asset_occurredAt_idx" ON "LedgerEntry"("merchantId", "asset", "occurredAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_payoutRunId_idx" ON "LedgerEntry"("payoutRunId");

-- CreateIndex
CREATE INDEX "LedgerEntry_sourceEscrowId_idx" ON "LedgerEntry"("sourceEscrowId");

-- AddForeignKey
ALTER TABLE "SettlementPeriod" ADD CONSTRAINT "SettlementPeriod_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRun" ADD CONSTRAINT "PayoutRun_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRun" ADD CONSTRAINT "PayoutRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "SettlementPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "SettlementPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_correctsEntryId_fkey" FOREIGN KEY ("correctsEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payoutRunId_fkey" FOREIGN KEY ("payoutRunId") REFERENCES "PayoutRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
