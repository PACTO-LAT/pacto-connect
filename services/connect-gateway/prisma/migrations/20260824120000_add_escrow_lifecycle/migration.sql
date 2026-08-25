-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('pending', 'funded', 'released', 'disputed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "EscrowActor" AS ENUM ('buyer', 'seller', 'merchant', 'admin', 'system');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "DisputeResolution" AS ENUM ('release', 'refund');

-- CreateTable
CREATE TABLE "Escrow" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'pending',
    "amount" DOUBLE PRECISION NOT NULL,
    "asset" TEXT NOT NULL,
    "merchantId" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "EscrowActor",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowRefund" (
    "id" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" "EscrowActor" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowDispute" (
    "id" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL,
    "actor" "EscrowActor" NOT NULL,
    "evidenceRefs" TEXT[],
    "resolution" "DisputeResolution",
    "resolvedBy" "EscrowActor",
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscrowDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Escrow_apiKeyId_sessionId_idx" ON "Escrow"("apiKeyId", "sessionId");

-- CreateIndex
CREATE INDEX "Escrow_status_idx" ON "Escrow"("status");

-- CreateIndex
CREATE INDEX "Escrow_merchantId_idx" ON "Escrow"("merchantId");

-- CreateIndex
CREATE INDEX "EscrowRefund_escrowId_idx" ON "EscrowRefund"("escrowId");

-- CreateIndex
CREATE INDEX "EscrowDispute_escrowId_idx" ON "EscrowDispute"("escrowId");

-- CreateIndex
CREATE INDEX "EscrowDispute_status_idx" ON "EscrowDispute"("status");

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowRefund" ADD CONSTRAINT "EscrowRefund_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowDispute" ADD CONSTRAINT "EscrowDispute_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
