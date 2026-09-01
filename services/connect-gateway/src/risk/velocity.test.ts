import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  prisma: {
    riskDecision: {
      aggregate: vi.fn(),
    },
  },
}));

import { prisma } from '../db.js';
import { computeMerchantVelocity } from './velocity.js';

describe('computeMerchantVelocity', () => {
  beforeEach(() => {
    vi.mocked(prisma.riskDecision.aggregate).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('sums amount and counts rows within the window, only counting allow/review outcomes', async () => {
    vi.mocked(prisma.riskDecision.aggregate).mockResolvedValue({
      _sum: { amount: 1234.5 },
      _count: { _all: 7 },
    } as never);

    const now = new Date('2026-01-01T12:00:00.000Z');
    const totals = await computeMerchantVelocity('mrc_1', 60_000, now);

    expect(totals).toEqual({ value: 1234.5, count: 7 });
    expect(prisma.riskDecision.aggregate).toHaveBeenCalledWith({
      where: {
        merchantId: 'mrc_1',
        outcome: { in: ['allow', 'review'] },
        createdAt: { gt: new Date('2026-01-01T11:59:00.000Z') },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
  });

  it('returns zero totals when there is no history', async () => {
    vi.mocked(prisma.riskDecision.aggregate).mockResolvedValue({
      _sum: { amount: null },
      _count: { _all: 0 },
    } as never);

    const totals = await computeMerchantVelocity('mrc_1', 60_000, new Date());
    expect(totals).toEqual({ value: 0, count: 0 });
  });
});
