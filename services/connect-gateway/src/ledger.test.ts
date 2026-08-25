import type { LedgerEntry, PayoutRun, SettlementPeriod } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({
  prisma: {
    settlementPeriod: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    ledgerEntry: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payoutRun: {
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from './db.js';
import {
  appendCorrectionEntry,
  appendSettlementEntry,
  closeSettlementPeriod,
  PeriodClosedError,
  parsePeriodKey,
  periodKeyForDate,
  signedAmount,
} from './ledger.js';

const openPeriod: SettlementPeriod = {
  id: 'prd_1',
  merchantId: 'mrc_1',
  periodKey: '2026-08',
  startsAt: new Date('2026-08-01T00:00:00.000Z'),
  endsAt: new Date('2026-09-01T00:00:00.000Z'),
  status: 'open',
  closedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

const baseEntry: LedgerEntry = {
  id: 'led_1',
  merchantId: 'mrc_1',
  periodId: 'prd_1',
  sourceEscrowId: 'esc_1',
  direction: 'credit',
  kind: 'settlement',
  amount: 100,
  asset: 'USDC',
  correctsEntryId: null,
  occurredAt: new Date('2026-08-15T00:00:00.000Z'),
  createdAt: new Date('2026-08-15T00:00:00.000Z'),
  payoutRunId: null,
};

describe('ledger module', () => {
  beforeEach(() => {
    vi.mocked(prisma.settlementPeriod.findUnique).mockReset();
    vi.mocked(prisma.settlementPeriod.create).mockReset();
    vi.mocked(prisma.settlementPeriod.update).mockReset();
    vi.mocked(prisma.ledgerEntry.create).mockReset();
    vi.mocked(prisma.ledgerEntry.findUnique).mockReset();
    vi.mocked(prisma.ledgerEntry.update).mockReset();
    vi.mocked(prisma.payoutRun.updateMany).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('parsePeriodKey returns UTC month boundaries', () => {
    const { startsAt, endsAt } = parsePeriodKey('2026-08');
    expect(startsAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(endsAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('periodKeyForDate uses UTC calendar month', () => {
    expect(periodKeyForDate(new Date('2026-08-15T12:00:00.000Z'))).toBe('2026-08');
  });

  it('signedAmount applies direction', () => {
    expect(signedAmount('credit', 50)).toBe(50);
    expect(signedAmount('debit', 50)).toBe(-50);
  });

  it('appendSettlementEntry creates a credit settlement entry', async () => {
    vi.mocked(prisma.settlementPeriod.findUnique).mockResolvedValue(openPeriod);
    vi.mocked(prisma.ledgerEntry.create).mockResolvedValue(baseEntry);

    const entry = await appendSettlementEntry(prisma, {
      merchantId: 'mrc_1',
      sourceEscrowId: 'esc_1',
      amount: 100,
      asset: 'USDC',
      occurredAt: new Date('2026-08-15T00:00:00.000Z'),
    });

    expect(entry.direction).toBe('credit');
    expect(entry.kind).toBe('settlement');
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
  });

  it('appendSettlementEntry rejects writes into a closed period', async () => {
    vi.mocked(prisma.settlementPeriod.findUnique).mockResolvedValue({
      ...openPeriod,
      status: 'closed',
      closedAt: new Date('2026-08-31T00:00:00.000Z'),
    });

    await expect(
      appendSettlementEntry(prisma, {
        merchantId: 'mrc_1',
        sourceEscrowId: 'esc_1',
        amount: 100,
        asset: 'USDC',
        occurredAt: new Date('2026-08-15T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(PeriodClosedError);
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('appendCorrectionEntry creates a new debit without updating the original', async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue(baseEntry);
    vi.mocked(prisma.settlementPeriod.findUnique).mockResolvedValue(openPeriod);
    vi.mocked(prisma.ledgerEntry.create).mockResolvedValue({
      ...baseEntry,
      id: 'led_2',
      direction: 'debit',
      kind: 'correction',
      correctsEntryId: 'led_1',
    });

    const correction = await appendCorrectionEntry({
      merchantId: 'mrc_1',
      correctsEntryId: 'led_1',
      occurredAt: new Date('2026-08-20T00:00:00.000Z'),
    });

    expect(correction.kind).toBe('correction');
    expect(correction.direction).toBe('debit');
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          correctsEntryId: 'led_1',
          kind: 'correction',
          direction: 'debit',
        }),
      }),
    );
  });

  it('closeSettlementPeriod marks period closed and finalizes open payout runs', async () => {
    vi.mocked(prisma.settlementPeriod.findUnique).mockResolvedValue(openPeriod);
    vi.mocked(prisma.settlementPeriod.update).mockResolvedValue({
      ...openPeriod,
      status: 'closed',
      closedAt: new Date('2026-08-31T00:00:00.000Z'),
    });
    vi.mocked(prisma.payoutRun.updateMany).mockResolvedValue({ count: 1 });

    const closed = await closeSettlementPeriod('mrc_1', '2026-08');
    expect(closed.status).toBe('closed');
    expect(prisma.payoutRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { periodId: 'prd_1', status: 'open' },
      }),
    );
  });
});
