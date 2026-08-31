/**
 * Circuit breaker guarding a downstream dependency (the Connect Gateway).
 *
 * States:
 *  - `closed`: requests flow normally. Consecutive failures accumulate.
 *  - `open`: requests are rejected immediately (fail fast) without being attempted.
 *  - `half_open`: after `resetTimeoutMs` elapses, a bounded number of trial
 *    requests are allowed through. A trial success closes the circuit; a
 *    trial failure reopens it.
 */

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export type CircuitBreakerTransitionReason =
  | 'failure_threshold'
  | 'reset_timeout_elapsed'
  | 'half_open_success'
  | 'half_open_failure';

export interface CircuitBreakerTransition {
  from: CircuitBreakerState;
  to: CircuitBreakerState;
  reason: CircuitBreakerTransitionReason;
  at: number;
}

export interface CircuitBreakerConfig {
  /** Consecutive failures (while closed) before the circuit opens. */
  failureThreshold: number;
  /** Time the circuit stays open before allowing a half-open trial. */
  resetTimeoutMs: number;
  /** Number of concurrent trial requests permitted while half-open. */
  halfOpenMaxAttempts: number;
  now?: () => number;
  onStateChange?: (transition: CircuitBreakerTransition) => void;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: Omit<CircuitBreakerConfig, 'now' | 'onStateChange'> = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 1,
};

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...config,
    };
  }

  /** Current state, after lazily applying any open -> half_open transition due to elapsed time. */
  getState(): CircuitBreakerState {
    this.refresh();
    return this.state;
  }

  /** How long until an open circuit becomes eligible for a half-open trial, or 0 if not open. */
  msUntilHalfOpen(): number {
    this.refresh();
    if (this.state !== 'open') {
      return 0;
    }
    const elapsed = this.now() - this.openedAt;
    return Math.max(0, this.config.resetTimeoutMs - elapsed);
  }

  /**
   * Asks permission to make a request. Returns `true` and (for half-open)
   * reserves a trial slot the caller MUST resolve via `onSuccess`/`onFailure`.
   */
  canRequest(): boolean {
    this.refresh();

    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      return false;
    }

    // half_open: allow a bounded number of concurrent trials.
    if (this.halfOpenInFlight < this.config.halfOpenMaxAttempts) {
      this.halfOpenInFlight += 1;
      return true;
    }

    return false;
  }

  onSuccess(): void {
    if (this.state === 'half_open') {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      this.transition('closed', 'half_open_success');
    }

    this.consecutiveFailures = 0;
  }

  onFailure(): void {
    if (this.state === 'half_open') {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      this.openedAt = this.now();
      this.transition('open', 'half_open_failure');
      return;
    }

    if (this.state === 'closed') {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.openedAt = this.now();
        this.transition('open', 'failure_threshold');
      }
    }
  }

  private refresh(): void {
    if (this.state !== 'open') {
      return;
    }

    const elapsed = this.now() - this.openedAt;
    if (elapsed >= this.config.resetTimeoutMs) {
      this.halfOpenInFlight = 0;
      this.transition('half_open', 'reset_timeout_elapsed');
    }
  }

  private transition(to: CircuitBreakerState, reason: CircuitBreakerTransitionReason): void {
    const from = this.state;
    if (from === to) {
      return;
    }

    this.state = to;
    if (to === 'closed') {
      this.consecutiveFailures = 0;
    }

    this.config.onStateChange?.({ from, to, reason, at: this.now() });
  }

  private now(): number {
    return this.config.now?.() ?? Date.now();
  }
}
