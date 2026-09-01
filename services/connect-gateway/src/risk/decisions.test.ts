import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  prisma: {
    riskDecision: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import type { RiskDecision } from '@prisma/client';
import { prisma } from '../db.js';
import { getRiskDecision, listRiskDecisions, recordRiskDecision } from './decisions.js';

const baseDecision: RiskDecision = {
  id: 'rdc_1',
  merchantId: 'mrc_1',
  sessionId: 'session_1',
  counterpartyRef: 'wallet_1',
  amount: 500,
  asset: 'USDC',
  outcome: 'review',
  reason: 'velocity_value_review',
  requestId: 'req_1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('risk decisions', () => {
  beforeEach(() => {
    vi.mocked(prisma.riskDecision.create).mockReset();
    vi.mocked(prisma.riskDecision.findMany).mockReset();
    vi.mocked(prisma.riskDecision.findUnique).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('recordRiskDecision persists and returns the public shape', async () => {
    vi.mocked(prisma.riskDecision.create).mockResolvedValue(baseDecision);

    const decision = await recordRiskDecision({
      merchantId: 'mrc_1',
      sessionId: 'session_1',
      counterpartyRef: 'wallet_1',
      amount: 500,
      asset: 'USDC',
      outcome: 'review',
      reason: 'velocity_value_review',
      requestId: 'req_1',
    });

    expect(decision.id).toBe('rdc_1');
    expect(decision.outcome).toBe('review');
  });

  it('listRiskDecisions is retrievable and not silently lost: filters by outcome and caps limit', async () => {
    vi.mocked(prisma.riskDecision.findMany).mockResolvedValue([baseDecision]);

    const decisions = await listRiskDecisions('mrc_1', { outcome: 'review', limit: 500 });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.outcome).toBe('review');
    expect(prisma.riskDecision.findMany).toHaveBeenCalledWith({
      where: { merchantId: 'mrc_1', outcome: 'review' },
      orderBy: { createdAt: 'desc' },
      take: 200, // capped
    });
  });

  it('listRiskDecisions defaults to a limit of 50', async () => {
    vi.mocked(prisma.riskDecision.findMany).mockResolvedValue([]);
    await listRiskDecisions('mrc_1');
    expect(prisma.riskDecision.findMany).toHaveBeenCalledWith({
      where: { merchantId: 'mrc_1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  it('getRiskDecision returns null when not found', async () => {
    vi.mocked(prisma.riskDecision.findUnique).mockResolvedValue(null);
    expect(await getRiskDecision('rdc_x')).toBeNull();
  });
});
