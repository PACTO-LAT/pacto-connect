import { describe, expect, it } from 'vitest';
import {
  applyCheckoutTransition,
  type CheckoutFlowState,
  CheckoutQuoteExpiredError,
  canTransition,
  createInitialCheckoutState,
  IllegalCheckoutTransitionError,
  isPersistableStep,
  isQuoteExpired,
} from './checkout-machine.js';

const baseState = (): CheckoutFlowState => ({
  ...createInitialCheckoutState(true),
  sessionId: 'sess_1',
});

describe('checkout-machine transitions', () => {
  it('allows legal transitions from loading', () => {
    expect(canTransition('loading', 'selectListing')).toBe(true);
    expect(canTransition('loading', 'deposit')).toBe(true);
    expect(canTransition('loading', 'uploadReceipt')).toBe(true);
    expect(canTransition('loading', 'tracking')).toBe(true);
    expect(canTransition('loading', 'error')).toBe(true);
  });

  it('allows tracking to reach terminal steps', () => {
    expect(canTransition('tracking', 'success')).toBe(true);
    expect(canTransition('tracking', 'disputed')).toBe(true);
    expect(canTransition('tracking', 'refunded')).toBe(true);
  });

  it('allows error to retry via loading', () => {
    expect(canTransition('error', 'loading')).toBe(true);
  });

  it('allows terminal steps to reset through loading only', () => {
    expect(canTransition('success', 'loading')).toBe(true);
    expect(canTransition('success', 'deposit')).toBe(false);
    expect(canTransition('refunded', 'loading')).toBe(true);
  });

  it('throws on illegal transitions', () => {
    expect(() => applyCheckoutTransition(baseState(), { step: 'success' })).toThrow(
      IllegalCheckoutTransitionError,
    );
  });

  it('applies legal transitions', () => {
    const next = applyCheckoutTransition(baseState(), { step: 'deposit' });
    expect(next.step).toBe('deposit');
  });

  it('allows same-step patches without throwing', () => {
    const next = applyCheckoutTransition(baseState(), {
      sessionId: 'sess_2',
    });
    expect(next.sessionId).toBe('sess_2');
    expect(next.step).toBe('loading');
  });
});

describe('checkout-machine expiry helpers', () => {
  it('detects expired quotes at the boundary', () => {
    const now = Date.parse('2024-01-02T00:00:00.000Z');
    expect(
      isQuoteExpired(
        {
          id: 'quo_1',
          asset: 'USDC',
          amount: '100',
          price: '5000',
          side: 'buy',
          expiresAt: '2024-01-02T00:00:00.000Z',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(true);

    expect(
      isQuoteExpired(
        {
          id: 'quo_1',
          asset: 'USDC',
          amount: '100',
          price: '5000',
          side: 'buy',
          expiresAt: '2024-01-02T00:00:01.000Z',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false);
  });

  it('treats invalid quote expiry timestamps as expired', () => {
    expect(
      isQuoteExpired(
        {
          id: 'quo_1',
          asset: 'USDC',
          amount: '100',
          price: '5000',
          side: 'buy',
          expiresAt: 'not-a-date',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        Date.now(),
      ),
    ).toBe(true);
  });

  it('marks only stable steps as persistable', () => {
    expect(isPersistableStep('deposit')).toBe(true);
    expect(isPersistableStep('loading')).toBe(false);
    expect(isPersistableStep('error')).toBe(false);
  });

  it('exposes a named quote-expired error', () => {
    const error = new CheckoutQuoteExpiredError();
    expect(error.name).toBe('CheckoutQuoteExpiredError');
  });
});
