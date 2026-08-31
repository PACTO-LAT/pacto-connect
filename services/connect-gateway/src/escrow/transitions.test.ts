import { describe, expect, it } from 'vitest';
import { assertTransition, type EscrowStatus } from './transitions.js';

const ALL_STATUSES: EscrowStatus[] = [
  'pending',
  'funded',
  'released',
  'disputed',
  'cancelled',
  'refunded',
];

describe('assertTransition — happy paths', () => {
  it('cancel from pending', () => {
    expect(assertTransition('pending', { type: 'cancel' })).toEqual({
      ok: true,
      nextStatus: 'cancelled',
    });
  });

  it('deposit from pending', () => {
    expect(assertTransition('pending', { type: 'deposit' })).toEqual({
      ok: true,
      nextStatus: 'funded',
    });
  });

  it('report_fiat from funded when not yet reported', () => {
    expect(assertTransition('funded', { type: 'report_fiat', fiatReported: false })).toEqual({
      ok: true,
      nextStatus: 'funded',
    });
  });

  it('release from funded', () => {
    expect(assertTransition('funded', { type: 'release' })).toEqual({
      ok: true,
      nextStatus: 'released',
    });
  });

  it('partial refund stays released', () => {
    expect(assertTransition('released', { type: 'refund', amount: 50, remaining: 100 })).toEqual({
      ok: true,
      nextStatus: 'released',
    });
  });

  it('full refund moves to refunded', () => {
    expect(assertTransition('released', { type: 'refund', amount: 100, remaining: 100 })).toEqual({
      ok: true,
      nextStatus: 'refunded',
    });
  });

  it('open dispute from funded', () => {
    expect(assertTransition('funded', { type: 'open_dispute' })).toEqual({
      ok: true,
      nextStatus: 'disputed',
    });
  });

  it('open dispute from released', () => {
    expect(assertTransition('released', { type: 'open_dispute' })).toEqual({
      ok: true,
      nextStatus: 'disputed',
    });
  });

  it('resolve dispute to release', () => {
    expect(assertTransition('disputed', { type: 'resolve_dispute', outcome: 'release' })).toEqual({
      ok: true,
      nextStatus: 'released',
    });
  });

  it('resolve dispute to refund', () => {
    expect(assertTransition('disputed', { type: 'resolve_dispute', outcome: 'refund' })).toEqual({
      ok: true,
      nextStatus: 'refunded',
    });
  });
});

describe('assertTransition — illegal cancel', () => {
  for (const status of ['funded', 'released', 'disputed', 'cancelled', 'refunded'] as const) {
    it(`rejects cancel from ${status}`, () => {
      const result = assertTransition(status, { type: 'cancel' });
      expect(result).toEqual({
        ok: false,
        code: 'invalid_transition',
        message: `Cannot cancel escrow in status ${status}`,
      });
    });
  }
});

describe('assertTransition — illegal refund', () => {
  for (const status of ['pending', 'funded', 'disputed', 'cancelled', 'refunded'] as const) {
    it(`rejects refund from ${status}`, () => {
      const result = assertTransition(status, { type: 'refund', amount: 10, remaining: 100 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('invalid_transition');
      }
    });
  }

  it('rejects zero refund amount', () => {
    const result = assertTransition('released', { type: 'refund', amount: 0, remaining: 100 });
    expect(result).toEqual({
      ok: false,
      code: 'refund_exceeds_balance',
      message: 'Refund amount must be greater than zero',
    });
  });

  it('rejects refund exceeding remaining balance', () => {
    const result = assertTransition('released', { type: 'refund', amount: 150, remaining: 100 });
    expect(result).toEqual({
      ok: false,
      code: 'refund_exceeds_balance',
      message: 'Refund amount exceeds remaining escrow balance',
    });
  });
});

describe('assertTransition — illegal open dispute', () => {
  for (const status of ['pending', 'cancelled', 'refunded', 'disputed'] as const) {
    it(`rejects open dispute from ${status}`, () => {
      const result = assertTransition(status, { type: 'open_dispute' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('invalid_transition');
      }
    });
  }
});

describe('assertTransition — illegal resolve dispute', () => {
  for (const status of ALL_STATUSES.filter((s) => s !== 'disputed')) {
    it(`rejects resolve from ${status}`, () => {
      const result = assertTransition(status, {
        type: 'resolve_dispute',
        outcome: 'release',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('invalid_transition');
      }
    });
  }
});

describe('assertTransition — illegal deposit', () => {
  for (const status of ALL_STATUSES.filter((s) => s !== 'pending')) {
    it(`rejects deposit from ${status}`, () => {
      const result = assertTransition(status, { type: 'deposit' });
      expect(result.ok).toBe(false);
    });
  }
});

describe('assertTransition — illegal report_fiat', () => {
  it('rejects when already reported', () => {
    const result = assertTransition('funded', { type: 'report_fiat', fiatReported: true });
    expect(result).toEqual({
      ok: false,
      code: 'invalid_transition',
      message: 'Fiat payment already reported for this escrow',
    });
  });

  for (const status of ALL_STATUSES.filter((s) => s !== 'funded')) {
    it(`rejects report_fiat from ${status}`, () => {
      const result = assertTransition(status, { type: 'report_fiat', fiatReported: false });
      expect(result.ok).toBe(false);
    });
  }
});

describe('assertTransition — illegal release', () => {
  for (const status of ALL_STATUSES.filter((s) => s !== 'funded')) {
    it(`rejects release from ${status}`, () => {
      const result = assertTransition(status, { type: 'release' });
      expect(result.ok).toBe(false);
    });
  }
});
