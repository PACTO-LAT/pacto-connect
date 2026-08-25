import type { LedgerDirection, PayoutRun, PayoutRunStatus, SettlementPeriod } from '@prisma/client';
import { prisma } from './db.js';
import { parsePeriodKey, signedAmount } from './ledger.js';

export class PayoutRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`payout run ${runId} not found`);
    this.name = 'PayoutRunNotFoundError';
  }
}

export interface PayoutRunPublic {
  id: string;
  merchantId: string;
  periodId: string;
  periodKey: string;
  asset: string;
  status: PayoutRunStatus;
  total: number;
  entryCount: number;
  createdAt: Date;
  finalizedAt: Date | null;
}

function toPublic(record: PayoutRun, periodKey: string, entryCount: number): PayoutRunPublic {
  return {
    id: record.id,
    merchantId: record.merchantId,
    periodId: record.periodId,
    periodKey,
    asset: record.asset,
    status: record.status,
    total: record.total,
    entryCount,
    createdAt: record.createdAt,
    finalizedAt: record.finalizedAt,
  };
}

async function resolvePeriod(
  merchantId: string,
  periodKey: string,
): Promise<SettlementPeriod | null> {
  parsePeriodKey(periodKey);
  return prisma.settlementPeriod.findUnique({
    where: { merchantId_periodKey: { merchantId, periodKey } },
  });
}

function computeTotal(entries: Array<{ direction: LedgerDirection; amount: number }>): number {
  return entries.reduce((sum, entry) => sum + signedAmount(entry.direction, entry.amount), 0);
}

export async function generatePayoutRun(input: {
  merchantId: string;
  periodKey: string;
  asset: string;
}): Promise<PayoutRunPublic> {
  const period = await resolvePeriod(input.merchantId, input.periodKey);
  if (!period) {
    throw new Error(`settlement period ${input.periodKey} not found for merchant`);
  }

  return prisma.$transaction(async (tx) => {
    let run = await tx.payoutRun.findUnique({
      where: {
        merchantId_periodId_asset: {
          merchantId: input.merchantId,
          periodId: period.id,
          asset: input.asset,
        },
      },
    });

    const eligible = await tx.ledgerEntry.findMany({
      where: {
        merchantId: input.merchantId,
        periodId: period.id,
        asset: input.asset,
        payoutRunId: null,
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });

    if (!run) {
      const total = computeTotal(eligible);
      run = await tx.payoutRun.create({
        data: {
          merchantId: input.merchantId,
          periodId: period.id,
          asset: input.asset,
          status: period.status === 'closed' ? 'finalized' : 'open',
          total,
          finalizedAt: period.status === 'closed' ? new Date() : null,
        },
      });
    }

    if (eligible.length > 0) {
      await tx.ledgerEntry.updateMany({
        where: { id: { in: eligible.map((entry) => entry.id) } },
        data: { payoutRunId: run.id },
      });
    }

    const assigned = await tx.ledgerEntry.findMany({
      where: { payoutRunId: run.id },
    });
    const total = computeTotal(assigned);
    const status: PayoutRunStatus = period.status === 'closed' ? 'finalized' : run.status;
    run = await tx.payoutRun.update({
      where: { id: run.id },
      data: {
        total,
        status,
        finalizedAt: status === 'finalized' ? (run.finalizedAt ?? new Date()) : run.finalizedAt,
      },
    });

    return toPublic(run, period.periodKey, assigned.length);
  });
}

export async function getPayoutRun(runId: string): Promise<PayoutRunPublic | null> {
  const run = await prisma.payoutRun.findUnique({
    where: { id: runId },
    include: { period: true, ledgerEntries: true },
  });
  if (!run) {
    return null;
  }
  return toPublic(run, run.period.periodKey, run.ledgerEntries.length);
}

export async function listPayoutRuns(filter: {
  merchantId?: string;
  periodKey?: string;
}): Promise<PayoutRunPublic[]> {
  let periodId: string | undefined;
  if (filter.periodKey) {
    if (!filter.merchantId) {
      throw new Error('merchantId is required when filtering by periodKey');
    }
    const period = await resolvePeriod(filter.merchantId, filter.periodKey);
    if (!period) {
      return [];
    }
    periodId = period.id;
  }

  const runs = await prisma.payoutRun.findMany({
    where: {
      merchantId: filter.merchantId,
      periodId,
    },
    include: {
      period: true,
      _count: { select: { ledgerEntries: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return runs.map((run) => toPublic(run, run.period.periodKey, run._count.ledgerEntries));
}
