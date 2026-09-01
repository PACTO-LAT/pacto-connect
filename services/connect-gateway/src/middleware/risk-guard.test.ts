import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../risk/evaluate.js', () => ({
  evaluateEscrowRisk: vi.fn(),
}));

import type { Context } from 'hono';
import { Hono } from 'hono';
import { RiskError } from '../errors.js';
import { evaluateEscrowRisk } from '../risk/evaluate.js';
import { requestId } from './request-id.js';
import { guardEscrowRisk } from './risk-guard.js';

const session = {
  id: 'session_1',
  merchantId: 'mrc_1',
  counterpartyRef: 'wallet_1',
};

function appWithGuard(handler: (c: Context) => Promise<Response>) {
  const app = new Hono();
  app.use('*', requestId());
  app.all('*', handler);
  return app;
}

describe('guardEscrowRisk', () => {
  beforeEach(() => {
    vi.mocked(evaluateEscrowRisk).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns the decision result and lets the caller proceed on allow', async () => {
    vi.mocked(evaluateEscrowRisk).mockResolvedValue({
      outcome: 'allow',
      reason: 'within_limits',
      decisionId: 'rdc_1',
    });

    const app = appWithGuard(async (c) => {
      const outcome = await guardEscrowRisk(c, { session, amount: 100, asset: 'USDC' });
      if ('error' in outcome) {
        return outcome.error;
      }
      return c.json({ ok: true, outcome: outcome.result });
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.outcome.outcome).toBe('allow');
  });

  it('blocks: an escrow-creation handler wired through the guard never reaches its create step', async () => {
    vi.mocked(evaluateEscrowRisk).mockRejectedValue(
      new RiskError('velocity_value_exceeded', 'merchant mrc_1 exceeded its value threshold'),
    );

    let createWasCalled = false;

    const app = appWithGuard(async (c) => {
      const outcome = await guardEscrowRisk(c, { session, amount: 100, asset: 'USDC' });
      if ('error' in outcome) {
        return outcome.error;
      }
      createWasCalled = true; // the escrow "create" step this guard is meant to prevent
      return c.json({ ok: true });
    });

    const res = await app.request('/');

    expect(createWasCalled).toBe(false);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.type).toBe('risk_error');
    expect(body.error.code).toBe('velocity_value_exceeded');
  });

  it('propagates non-RiskError failures instead of swallowing them', async () => {
    vi.mocked(evaluateEscrowRisk).mockRejectedValue(new Error('db unavailable'));

    const app = appWithGuard(async (c) => {
      const outcome = await guardEscrowRisk(c, { session, amount: 100, asset: 'USDC' });
      if ('error' in outcome) {
        return outcome.error;
      }
      return c.json({ ok: true });
    });

    const res = await app.request('/');
    expect(res.status).toBe(500);
  });
});
