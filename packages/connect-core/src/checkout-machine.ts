import type { EscrowEvent } from './escrow-events.js';
import type { Escrow, Listing, Quote } from './resources.js';

export type CheckoutStep =
  | 'loading'
  | 'selectListing'
  | 'deposit'
  | 'uploadReceipt'
  | 'tracking'
  | 'success'
  | 'disputed'
  | 'refunded'
  | 'error';

export interface CheckoutFlowState {
  step: CheckoutStep;
  sessionId: string | null;
  listings: Listing[];
  selectedListing: Listing | null;
  escrow: Escrow | null;
  quote: Quote | null;
  error: Error | null;
  milestones: EscrowEvent[];
  testMode: boolean;
}

export class CheckoutQuoteExpiredError extends Error {
  constructor(message = 'This quote has expired. Please start checkout again.') {
    super(message);
    this.name = 'CheckoutQuoteExpiredError';
  }
}

export class IllegalCheckoutTransitionError extends Error {
  readonly from: CheckoutStep;
  readonly to: CheckoutStep;

  constructor(from: CheckoutStep, to: CheckoutStep) {
    super(`Illegal checkout transition from "${from}" to "${to}"`);
    this.name = 'IllegalCheckoutTransitionError';
    this.from = from;
    this.to = to;
  }
}

const TERMINAL_STEPS = new Set<CheckoutStep>(['success', 'refunded']);

const LEGAL_TRANSITIONS: Record<CheckoutStep, readonly CheckoutStep[]> = {
  loading: ['selectListing', 'deposit', 'uploadReceipt', 'tracking', 'error'],
  selectListing: ['loading', 'error'],
  deposit: ['loading', 'error'],
  uploadReceipt: ['loading', 'error'],
  tracking: ['success', 'disputed', 'refunded', 'error'],
  disputed: ['success', 'refunded', 'error'],
  success: ['loading', 'error'],
  refunded: ['loading', 'error'],
  error: ['loading'],
};

export function createInitialCheckoutState(testMode = false): CheckoutFlowState {
  return {
    step: 'loading',
    sessionId: null,
    listings: [],
    selectedListing: null,
    escrow: null,
    quote: null,
    error: null,
    milestones: [],
    testMode,
  };
}

export function canTransition(from: CheckoutStep, to: CheckoutStep): boolean {
  if (from === to) {
    return true;
  }

  return LEGAL_TRANSITIONS[from].includes(to);
}

export function isPersistableStep(step: CheckoutStep): boolean {
  return step !== 'loading' && step !== 'error';
}

export function isQuoteExpired(quote: Quote | null, now: number): boolean {
  if (!quote?.expiresAt) {
    return false;
  }

  const expiresAt = Date.parse(quote.expiresAt);
  if (Number.isNaN(expiresAt)) {
    return true;
  }

  return expiresAt <= now;
}

export function applyCheckoutTransition(
  state: CheckoutFlowState,
  partial: Partial<CheckoutFlowState>,
): CheckoutFlowState {
  const nextStep = partial.step ?? state.step;

  if (nextStep !== state.step && !canTransition(state.step, nextStep)) {
    throw new IllegalCheckoutTransitionError(state.step, nextStep);
  }

  return {
    ...state,
    ...partial,
    step: nextStep,
  };
}

export function isTerminalCheckoutStep(step: CheckoutStep): boolean {
  return TERMINAL_STEPS.has(step);
}
