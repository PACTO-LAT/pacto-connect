import {
  isRetryableError,
  PactoCircuitOpenError,
  PactoRateLimitError,
  PactoRetryExhaustedError,
  PactoTimeoutError,
} from '../errors.js';
import {
  CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerTransition,
} from './circuit-breaker.js';

/**
 * Shared, bounded, configurable and observable resilience policy applied to
 * every network path in the SDK (`http.ts`, `sse.ts`, `escrow-events.ts`,
 * `bridge.ts`). One instance is created per Pacto client/session and shared
 * across every request it makes, so the retry budget and circuit breaker are
 * scoped to that session rather than to any single call.
 */

export interface ResiliencePolicyConfig {
  /** Per-attempt timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Idle-read timeout for long-lived streams (SSE) in milliseconds. Default 45000. */
  streamIdleTimeoutMs?: number;
  /** Maximum retries for a single call, on top of its first attempt. Default 3. */
  maxRetries?: number;
  /** Total retry attempts permitted across every call sharing this policy instance. Default 50. */
  retryBudget?: number;
  /** Base delay for exponential backoff, in milliseconds. Default 250. */
  baseDelayMs?: number;
  /** Backoff delay ceiling, in milliseconds. Default 8000. */
  maxDelayMs?: number;
  /** Overrides the taxonomy-driven retryability classification. */
  isRetryable?: (error: unknown) => boolean;
  /** Circuit breaker configuration. Pass `false` to disable the breaker entirely. */
  breaker?: Partial<CircuitBreakerConfig> | false;
  onBreakerStateChange?: (transition: CircuitBreakerTransition) => void;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export const DEFAULT_RESILIENCE_CONFIG = {
  timeoutMs: 10_000,
  streamIdleTimeoutMs: 45_000,
  maxRetries: 3,
  retryBudget: 50,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
} as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full-jitter exponential backoff: a uniform random delay in `[0, min(maxDelayMs, base*2^attempt)]`. */
export function computeBackoffDelay(
  attempt: number,
  config: { baseDelayMs: number; maxDelayMs: number },
  random: () => number = Math.random,
): number {
  const cap = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * cap);
}

/** Bounds the total number of retry attempts a policy instance will grant over its lifetime. */
export class RetryBudget {
  private used = 0;

  constructor(private readonly maxAttempts: number) {}

  get limit(): number {
    return this.maxAttempts;
  }

  get remaining(): number {
    return Math.max(0, this.maxAttempts - this.used);
  }

  get consumed(): number {
    return this.used;
  }

  tryConsume(): boolean {
    if (this.used >= this.maxAttempts) {
      return false;
    }
    this.used += 1;
    return true;
  }

  reset(): void {
    this.used = 0;
  }
}

/**
 * Races `operation` against a timer. `operation` receives an `AbortSignal`
 * that fires when the timeout elapses, so it can cancel in-flight work (e.g.
 * pass it through to `fetch`). Rejects with `onTimeout()` if the timer wins.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            reject(onTimeout());
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ExecuteContext {
  attempt: number;
  signal: AbortSignal;
}

export class ResiliencePolicy {
  readonly budget: RetryBudget;
  readonly breaker: CircuitBreaker | null;

  private readonly timeout: number;
  private readonly streamIdleTimeout: number;
  private readonly maxRetries: number;
  private readonly backoffConfig: { baseDelayMs: number; maxDelayMs: number };
  private readonly retryable: (error: unknown) => boolean;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly randomFn: () => number;
  private readonly onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;

  constructor(config: ResiliencePolicyConfig = {}) {
    this.timeout = config.timeoutMs ?? DEFAULT_RESILIENCE_CONFIG.timeoutMs;
    this.streamIdleTimeout =
      config.streamIdleTimeoutMs ?? DEFAULT_RESILIENCE_CONFIG.streamIdleTimeoutMs;
    this.maxRetries = config.maxRetries ?? DEFAULT_RESILIENCE_CONFIG.maxRetries;
    this.backoffConfig = {
      baseDelayMs: config.baseDelayMs ?? DEFAULT_RESILIENCE_CONFIG.baseDelayMs,
      maxDelayMs: config.maxDelayMs ?? DEFAULT_RESILIENCE_CONFIG.maxDelayMs,
    };
    this.retryable = config.isRetryable ?? isRetryableError;
    this.sleepFn = config.sleep ?? defaultSleep;
    this.randomFn = config.random ?? Math.random;
    this.onRetry = config.onRetry;

    this.budget = new RetryBudget(config.retryBudget ?? DEFAULT_RESILIENCE_CONFIG.retryBudget);

    if (config.breaker === false) {
      this.breaker = null;
    } else {
      this.breaker = new CircuitBreaker({
        ...config.breaker,
        now: config.now,
        onStateChange: config.onBreakerStateChange,
      });
    }
  }

  get timeoutMs(): number {
    return this.timeout;
  }

  get streamIdleTimeoutMs(): number {
    return this.streamIdleTimeout;
  }

  isRetryable(error: unknown): boolean {
    return this.retryable(error);
  }

  computeDelay(attempt: number): number {
    return computeBackoffDelay(attempt, this.backoffConfig, this.randomFn);
  }

  sleep(ms: number): Promise<void> {
    return this.sleepFn(ms);
  }

  /**
   * Runs `operation`, applying the breaker, a per-attempt timeout, and
   * taxonomy-driven retry-with-backoff up to `maxRetries` for this call — all
   * additional retry attempts are also debited against the shared session
   * `budget`.
   */
  async execute<T>(operation: (context: ExecuteContext) => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      if (this.breaker && !this.breaker.canRequest()) {
        throw new PactoCircuitOpenError(
          'circuit_open',
          'Circuit breaker is open; request rejected without being attempted',
        );
      }

      try {
        const result = await withTimeout(
          (signal) => operation({ attempt, signal }),
          this.timeout,
          () => new PactoTimeoutError('request_timeout', 'Request timed out'),
        );
        this.breaker?.onSuccess();
        return result;
      } catch (error) {
        this.breaker?.onFailure();

        if (!this.retryable(error) || attempt >= this.maxRetries) {
          throw error;
        }

        if (!this.budget.tryConsume()) {
          throw new PactoRetryExhaustedError(
            'retry_budget_exhausted',
            'Session-wide retry budget exhausted',
            attempt + 1,
          );
        }

        // A rate-limit response's `Retry-After` hint takes precedence over
        // our own backoff schedule — the gateway is telling us exactly how
        // long to wait.
        const delay =
          error instanceof PactoRateLimitError && error.retryAfter !== undefined
            ? error.retryAfter
            : this.computeDelay(attempt);
        this.onRetry?.({ attempt, delayMs: delay, error });
        await this.sleepFn(delay);
        attempt += 1;
      }
    }
  }
}
