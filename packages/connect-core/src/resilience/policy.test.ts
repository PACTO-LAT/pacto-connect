import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PactoApiError,
  PactoCircuitOpenError,
  PactoRateLimitError,
  PactoRetryExhaustedError,
  PactoTimeoutError,
} from '../errors.js';
import { computeBackoffDelay, ResiliencePolicy, RetryBudget, withTimeout } from './policy.js';

describe('computeBackoffDelay', () => {
  it('is bounded by min(maxDelayMs, base*2^attempt)', () => {
    const config = { baseDelayMs: 100, maxDelayMs: 10_000 };
    for (const attempt of [0, 1, 2, 3, 4]) {
      const cap = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
      for (let i = 0; i < 20; i++) {
        const delay = computeBackoffDelay(attempt, config);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('is capped by maxDelayMs even at high attempt counts', () => {
    const config = { baseDelayMs: 100, maxDelayMs: 1_000 };
    const delay = computeBackoffDelay(10, config, () => 1);
    expect(delay).toBe(1_000);
  });

  it('produces a spread of delays across repeated calls, not a fixed sequence', () => {
    const config = { baseDelayMs: 200, maxDelayMs: 10_000 };
    const samples = Array.from({ length: 50 }, () => computeBackoffDelay(3, config));
    const distinctValues = new Set(samples);

    // With real randomness, 50 samples over a [0, 1600] range should not
    // collapse to a single value or a short deterministic cycle.
    expect(distinctValues.size).toBeGreaterThan(10);
  });

  it('is deterministic when given a fixed random source', () => {
    const config = { baseDelayMs: 100, maxDelayMs: 10_000 };
    expect(computeBackoffDelay(2, config, () => 0.5)).toBe(200);
    expect(computeBackoffDelay(0, config, () => 0)).toBe(0);
  });
});

describe('RetryBudget', () => {
  it('grants attempts up to the configured maximum', () => {
    const budget = new RetryBudget(2);
    expect(budget.remaining).toBe(2);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.remaining).toBe(0);
    expect(budget.tryConsume()).toBe(false);
  });

  it('reset() restores the full budget', () => {
    const budget = new RetryBudget(1);
    budget.tryConsume();
    expect(budget.remaining).toBe(0);
    budget.reset();
    expect(budget.remaining).toBe(1);
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the operation result when it finishes before the deadline', async () => {
    const promise = withTimeout(
      async () => 'ok',
      1_000,
      () => new Error('timed out'),
    );
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects with the timeout error once the deadline elapses', async () => {
    const promise = withTimeout(
      () => new Promise<string>(() => {}),
      1_000,
      () => new Error('timed out'),
    );
    const assertion = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('passes an AbortSignal that fires exactly when the timeout elapses', async () => {
    let observedSignal: AbortSignal | undefined;
    const promise = withTimeout(
      (signal) => {
        observedSignal = signal;
        return new Promise<string>(() => {});
      },
      500,
      () => new Error('timed out'),
    );
    const assertion = expect(promise).rejects.toThrow();

    expect(observedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(observedSignal?.aborted).toBe(true);
    await assertion;
  });
});

describe('ResiliencePolicy.execute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on a successful first attempt without retrying', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    const policy = new ResiliencePolicy({ sleep: async () => {} });

    await expect(policy.execute(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable error up to maxRetries and then succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new PactoApiError('upstream', 'down', { code: 'PACTO_UPSTREAM' }))
      .mockRejectedValueOnce(new PactoApiError('upstream', 'down', { code: 'PACTO_UPSTREAM' }))
      .mockResolvedValueOnce('ok');
    const sleep = vi.fn(async () => {});
    const policy = new ResiliencePolicy({ maxRetries: 3, sleep });

    await expect(policy.execute(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable error', async () => {
    const error = new PactoApiError('bad_request', 'nope', { code: 'PACTO_VALIDATION' });
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});
    const policy = new ResiliencePolicy({ maxRetries: 3, sleep });

    await expect(policy.execute(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws the original error once maxRetries is exhausted', async () => {
    const error = new PactoApiError('upstream', 'down', { code: 'PACTO_UPSTREAM' });
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});
    const policy = new ResiliencePolicy({ maxRetries: 2, retryBudget: 50, sleep });

    await expect(policy.execute(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('times out a hanging attempt with a PactoTimeoutError', async () => {
    const operation = vi.fn(() => new Promise<string>(() => {}));
    const policy = new ResiliencePolicy({ timeoutMs: 1_000, maxRetries: 0, sleep: async () => {} });

    const result = policy.execute(operation);
    const assertion = expect(result).rejects.toBeInstanceOf(PactoTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('exhausts the session-wide retry budget and throws PactoRetryExhaustedError', async () => {
    const error = new PactoApiError('upstream', 'down', { code: 'PACTO_UPSTREAM' });
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});
    // maxRetries is generous, but the shared budget is smaller — budget wins.
    const policy = new ResiliencePolicy({ maxRetries: 10, retryBudget: 1, sleep });

    await expect(policy.execute(operation)).rejects.toBeInstanceOf(PactoRetryExhaustedError);
  });

  it('rejects fast with PactoCircuitOpenError while the breaker is open, without invoking the operation', async () => {
    const error = new PactoApiError('upstream', 'down', { code: 'PACTO_UPSTREAM' });
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});
    const policy = new ResiliencePolicy({
      maxRetries: 0,
      breaker: { failureThreshold: 1 },
      sleep,
    });

    await expect(policy.execute(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);

    operation.mockClear();
    await expect(policy.execute(operation)).rejects.toBeInstanceOf(PactoCircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('honors a PactoRateLimitError retryAfter hint over the computed backoff delay', async () => {
    const rateLimitError = new PactoRateLimitError('rate_limited', 'slow down', 7_000);
    const operation = vi.fn().mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce('ok');
    const sleep = vi.fn(async () => {});
    const policy = new ResiliencePolicy({ maxRetries: 1, sleep });

    await policy.execute(operation);
    expect(sleep).toHaveBeenCalledWith(7_000);
  });

  it('classifies an unrecognized thrown value as retryable by default', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const sleep = vi.fn(async () => {});
    const policy = new ResiliencePolicy({ maxRetries: 1, sleep });

    await expect(policy.execute(operation)).resolves.toBe('ok');
  });

  it('allows a custom isRetryable classifier to override the default', async () => {
    const error = new PactoApiError('upstream', 'down', { code: 'PACTO_UPSTREAM' });
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});
    const policy = new ResiliencePolicy({ maxRetries: 3, sleep, isRetryable: () => false });

    await expect(policy.execute(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
