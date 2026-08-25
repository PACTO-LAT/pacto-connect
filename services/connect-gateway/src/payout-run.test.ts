import type { LedgerEntry, PayoutRun, SettlementPeriod } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({
  prisma: {
    settlementPeriod: {
      findUnique: vi.fn(),
    },
    ledgerEntry: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    payoutRun: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock())),
  },
}));

import { prisma } from './db.js';

function prismaMock() {
  return prisma;
}

import { generatePayoutRun, listPayoutRuns } from './payout-run.js';

const period: SettlementPeriod = {
  id: 'prd_1',
  merchantId: 'mrc_1',
  periodKey: '2026-08',
  startsAt: new Date('2026-08-01T00:00:00.000Z'),
  endsAt: new Date('2026-09-01T00:00:00.000Z'),
  status: 'open',
  closedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

const entryA: LedgerEntry = {
  id: 'led_1',
  merchantId: 'mrc_1',
  periodId: 'prd_1',
  sourceEscrowId: 'esc_1',
  direction: 'credit',
  kind: 'settlement',
  amount: 100,
  asset: 'USDC',
  correctsEntryId: null,
  occurredAt: new Date('2026-08-10T00:00:00.000Z'),
  createdAt: new Date('2026-08-10T00:00:00.000Z'),
  payoutRunId: null,
};

const run: PayoutRun = {
  id: 'pay_1',
  merchantId: 'mrc_1',
  periodId: 'prd_1',
  asset: 'USDC',
  status: 'open',
  total: 100,
  createdAt: new Date('2026-08-20T00:00:00.000Z'),
  finalizedAt: null,
};

describe('payout-run module', () => {
  beforeEach(() => {
    vi.mocked(prisma.settlementPeriod.findUnique).mockReset();
    vi.mocked(prisma.ledgerEntry.findMany).mockReset();
    vi.mocked(prisma.ledgerEntry.updateMany).mockReset();
    vi.mocked(prisma.payoutRun.findUnique).mockReset();
    vi.mocked(prisma.payoutRun.findMany).mockReset();
    vi.mocked(prisma.payoutRun.create).mockReset();
    vi.mocked(prisma.payoutRun.update).mockReset();
    vi.mocked(prisma.$transaction).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('generatePayoutRun creates a run and assigns eligible entries', async () => {
    vi.mocked(prisma.settlementPeriod.findUnique).mockResolvedValue(period);
    vi.mocked(prisma.payoutRun.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.ledgerEntry.findMany)
      .mockResolvedValueOnce([entryA])
      .mockResolvedValueOnce([{ ...entryA, payoutRunId: 'pay_1' }]);
    vi.mocked(prisma.payoutRun.create).mockResolvedValue(run);
    vi.mocked(prisma.payoutRun.update).mockResolvedValue(run);
    vi.mocked(prisma.ledgerEntry.updateMany).mockResolvedValue({ count: 1 });

    const result = await generatePayoutRun({
      merchantId: 'mrc_1',
      periodKey: '2026-08',
      asset: 'USDC',
    });

    expect(result.id).toBe('pay_1');
    expect(result.total).toBe(100);
    expect(prisma.payoutRun.create).toHaveBeenCalledTimes(1);
  });

  it('generatePayoutRun twice reuses the same run and does not double-count', async () => {
    vi.mocked(prisma.settlementPeriod.findUnique).mockResolvedValue(period);
    vi.mocked(prisma.payoutRun.findUnique).mockResolvedValue(run);
    vi.mocked(prisma.ledgerEntry.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...entryA, payoutRunId: 'pay_1' }]);
    vi.mocked(prisma.payoutRun.update).mockResolvedValue(run);

    const result = await generatePayoutRun({
      merchantId: 'mrc_1',
      periodKey: '2026-08',
      asset: 'USDC',
    });

    expect(result.id).toBe('pay_1');
    expect(result.total).toBe(100);
    expect(prisma.payoutRun.create).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.updateMany).not.toHaveBeenCalled();
  });

  it('generatePayoutRun assigns only newly eligible entries on second run', async () => {
    const entryB = { ...entryA, id: 'led_2', amount: 50, sourceEscrowId: 'esc_2' };
    vi.mocked(prisma.settlementPeriod.findUnique).mockResolvedValue(period);
    vi.mocked(prisma.payoutRun.findUnique).mockResolvedValue(run);
    vi.mocked(prisma.ledgerEntry.findMany)
      .mockResolvedValueOnce([entryB])
      .mockResolvedValueOnce([
        { ...entryA, payoutRunId: 'pay_1' },
        { ...entryB, payoutRunId: 'pay_1' },
      ]);
    vi.mocked(prisma.payoutRun.update).mockResolvedValue({ ...run, total: 150 });
    vi.mocked(prisma.ledgerEntry.updateMany).mockResolvedValue({ count: 1 });

    const result = await generatePayoutRun({
      merchantId: 'mrc_1',
      periodKey: '2026-08',
      asset: 'USDC',
    });

    expect(result.total).toBe(150);
    expect(prisma.payoutRun.create).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.updateMany).toHaveBeenCalledTimes(1);
  });

  it('listPayoutRuns filters by merchant and period', async () => {
    vi.mocked(prisma.settlementPeriod.findUnique).mockResolvedValue(period);
    vi.mocked(prisma.payoutRun.findMany).mockResolvedValue([
      {
        ...run,
        period,
        _count: { ledgerEntries: 1 },
      },
    ] as never);

    const runs = await listPayoutRuns({ merchantId: 'mrc_1', periodKey: '2026-08' });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.entryCount).toBe(1);
  });
});
