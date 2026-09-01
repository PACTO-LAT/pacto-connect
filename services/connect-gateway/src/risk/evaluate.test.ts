import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  createLogger: () => loggerSpies,
}));

vi.mock('./decisions.js', () => ({
  recordRiskDecision: vi.fn(),
}));

vi.mock('./settings.js', () => ({
  getEffectiveRiskThresholds: vi.fn(),
}));

vi.mock('./velocity.js', () => ({
  computeMerchantVelocity: vi.fn(),
}));

vi.mock('./lists.js', () => ({
  isCounterpartyListed: vi.fn(),
}));

import { RiskError } from '../errors.js';
import { recordRiskDecision } from './decisions.js';
import { evaluateEscrowRisk } from './evaluate.js';
import { isCounterpartyListed } from './lists.js';
import { getEffectiveRiskThresholds } from './settings.js';
import { computeMerchantVelocity } from './velocity.js';

const thresholds = {
  windowMs: 60_000,
  valueThreshold: 1000,
  countThreshold: 10,
  reviewValueThreshold: 800,
  reviewCountThreshold: 8,
};

function baseInput(overrides: Partial<Parameters<typeof evaluateEscrowRisk>[0]> = {}) {
  return {
    merchantId: 'mrc_1',
    counterpartyRef: null,
    sessionId: 'session_1',
    amount: 100,
    asset: 'USDC',
    requestId: 'req_1',
    ...overrides,
  };
}

let nextDecisionId = 0;

describe('evaluateEscrowRisk', () => {
  beforeEach(() => {
    vi.mocked(recordRiskDecision).mockReset();
    vi.mocked(getEffectiveRiskThresholds).mockReset();
    vi.mocked(computeMerchantVelocity).mockReset();
    vi.mocked(isCounterpartyListed).mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();

    nextDecisionId = 0;
    vi.mocked(recordRiskDecision).mockImplementation(async (input) => ({
      id: `rdc_${++nextDecisionId}`,
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      counterpartyRef: input.counterpartyRef ?? null,
      amount: input.amount,
      asset: input.asset,
      outcome: input.outcome,
      reason: input.reason,
      requestId: input.requestId ?? null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }));
    vi.mocked(getEffectiveRiskThresholds).mockResolvedValue(thresholds);
    vi.mocked(computeMerchantVelocity).mockResolvedValue({ value: 0, count: 0 });
    vi.mocked(isCounterpartyListed).mockResolvedValue(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns null and records nothing when there is no merchant context', async () => {
    const result = await evaluateEscrowRisk(baseInput({ merchantId: null }));
    expect(result).toBeNull();
    expect(recordRiskDecision).not.toHaveBeenCalled();
    expect(loggerSpies.info).not.toHaveBeenCalled();
    expect(loggerSpies.warn).not.toHaveBeenCalled();
    expect(loggerSpies.error).not.toHaveBeenCalled();
  });

  describe('velocity: below, at, and above threshold', () => {
    it('below threshold: allows', async () => {
      vi.mocked(computeMerchantVelocity).mockResolvedValue({ value: 500, count: 1 });
      const result = await evaluateEscrowRisk(baseInput({ amount: 100 })); // prospective 600 < 800 review

      expect(result).toEqual({ outcome: 'allow', reason: 'within_limits', decisionId: 'rdc_1' });
      expect(loggerSpies.info).toHaveBeenCalledWith(
        'escrow risk decision: allowed',
        expect.objectContaining({ outcome: 'allow', requestId: 'req_1' }),
      );
    });

    it('at the block threshold exactly: not exceeding, so review (not block)', async () => {
      // prospective value == valueThreshold (1000): "exceeding" means strictly greater, so this
      // must not block. It is still above the review threshold (800), so it is a review.
      vi.mocked(computeMerchantVelocity).mockResolvedValue({ value: 900, count: 1 });
      const result = await evaluateEscrowRisk(baseInput({ amount: 100 }));

      expect(result).toEqual({
        outcome: 'review',
        reason: 'velocity_value_review',
        decisionId: 'rdc_1',
      });
      expect(loggerSpies.warn).toHaveBeenCalledWith(
        'escrow risk decision: flagged for review',
        expect.objectContaining({ outcome: 'review', reason: 'velocity_value_review' }),
      );
    });

    it('above the block threshold: blocks with a typed RiskError and records+logs before throwing', async () => {
      vi.mocked(computeMerchantVelocity).mockResolvedValue({ value: 950, count: 1 });
      const promise = evaluateEscrowRisk(baseInput({ amount: 100 })); // prospective 1050 > 1000

      await expect(promise).rejects.toBeInstanceOf(RiskError);
      await expect(promise).rejects.toMatchObject({ code: 'velocity_value_exceeded' });

      expect(recordRiskDecision).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'block', reason: 'velocity_value_exceeded' }),
      );
      expect(loggerSpies.error).toHaveBeenCalledWith(
        'escrow risk decision: blocked',
        expect.objectContaining({ outcome: 'block', reason: 'velocity_value_exceeded' }),
      );
    });

    it('above the count threshold: blocks with velocity_count_exceeded', async () => {
      vi.mocked(computeMerchantVelocity).mockResolvedValue({ value: 10, count: 10 });
      const promise = evaluateEscrowRisk(baseInput({ amount: 1 })); // prospective count 11 > 10

      await expect(promise).rejects.toMatchObject({ code: 'velocity_count_exceeded' });
      expect(recordRiskDecision).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'block', reason: 'velocity_count_exceeded' }),
      );
    });
  });

  describe('allow/deny list precedence', () => {
    it('a counterparty on the deny list is blocked regardless of velocity being well under threshold', async () => {
      vi.mocked(isCounterpartyListed).mockImplementation(
        async (_merchantId, _ref, listType) => listType === 'deny',
      );
      vi.mocked(computeMerchantVelocity).mockResolvedValue({ value: 0, count: 0 });

      const promise = evaluateEscrowRisk(baseInput({ counterpartyRef: 'wallet_bad', amount: 1 }));

      await expect(promise).rejects.toMatchObject({ code: 'deny_listed' });
      expect(recordRiskDecision).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'block', reason: 'deny_list' }),
      );
      // Velocity must never be consulted once denied.
      expect(computeMerchantVelocity).not.toHaveBeenCalled();
    });

    it('a counterparty on the allow list bypasses velocity even when it would otherwise block', async () => {
      vi.mocked(isCounterpartyListed).mockImplementation(
        async (_merchantId, _ref, listType) => listType === 'allow',
      );
      vi.mocked(computeMerchantVelocity).mockResolvedValue({ value: 10_000, count: 1 });

      const result = await evaluateEscrowRisk(
        baseInput({ counterpartyRef: 'wallet_good', amount: 10_000 }),
      );

      expect(result).toEqual({ outcome: 'allow', reason: 'allow_list', decisionId: 'rdc_1' });
      expect(computeMerchantVelocity).not.toHaveBeenCalled();
    });

    it('precedence: a counterparty on both lists is blocked (deny wins over allow)', async () => {
      vi.mocked(isCounterpartyListed).mockResolvedValue(true); // on both allow and deny

      const promise = evaluateEscrowRisk(baseInput({ counterpartyRef: 'wallet_both' }));

      await expect(promise).rejects.toMatchObject({ code: 'deny_listed' });
      expect(recordRiskDecision).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'block', reason: 'deny_list' }),
      );
    });

    it('a counterparty on neither list still goes through velocity checks', async () => {
      vi.mocked(isCounterpartyListed).mockResolvedValue(false);
      vi.mocked(computeMerchantVelocity).mockResolvedValue({ value: 0, count: 0 });

      const result = await evaluateEscrowRisk(
        baseInput({ counterpartyRef: 'wallet_unknown', amount: 100 }),
      );

      expect(result?.outcome).toBe('allow');
      expect(computeMerchantVelocity).toHaveBeenCalled();
    });
  });
});
