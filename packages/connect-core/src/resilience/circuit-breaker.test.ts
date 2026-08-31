import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

function clock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('CircuitBreaker', () => {
  it('starts closed and allows requests', () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.canRequest()).toBe(true);
  });

  it('stays closed while failures remain under the threshold', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.canRequest()).toBe(true);
  });

  it('opens after the configured consecutive failure threshold', () => {
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker({ failureThreshold: 3, onStateChange });

    breaker.onFailure();
    breaker.onFailure();
    breaker.onFailure();

    expect(breaker.getState()).toBe('open');
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'closed', to: 'open', reason: 'failure_threshold' }),
    );
  });

  it('rejects fast (canRequest returns false) while open', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10_000 });
    breaker.onFailure();

    expect(breaker.getState()).toBe('open');
    expect(breaker.canRequest()).toBe(false);
    expect(breaker.canRequest()).toBe(false);
  });

  it('a success resets the consecutive-failure counter while closed', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    breaker.onFailure();
    breaker.onFailure();
    breaker.onSuccess();
    breaker.onFailure();
    breaker.onFailure();

    expect(breaker.getState()).toBe('closed');
  });

  it('transitions open -> half_open once resetTimeoutMs elapses', () => {
    const time = clock();
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 5_000,
      now: time.now,
      onStateChange,
    });

    breaker.onFailure();
    expect(breaker.getState()).toBe('open');

    time.advance(4_999);
    expect(breaker.getState()).toBe('open');

    time.advance(1);
    expect(breaker.getState()).toBe('half_open');
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'open', to: 'half_open', reason: 'reset_timeout_elapsed' }),
    );
  });

  it('a half-open trial success closes the circuit', () => {
    const time = clock();
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      now: time.now,
    });

    breaker.onFailure();
    time.advance(1_000);
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.getState()).toBe('half_open');

    breaker.onSuccess();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.canRequest()).toBe(true);
  });

  it('a half-open trial failure reopens the circuit', () => {
    const time = clock();
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      now: time.now,
      onStateChange,
    });

    breaker.onFailure();
    time.advance(1_000);
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.getState()).toBe('half_open');

    breaker.onFailure();
    expect(breaker.getState()).toBe('open');
    expect(breaker.canRequest()).toBe(false);
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'half_open', to: 'open', reason: 'half_open_failure' }),
    );

    // And the reopened circuit runs through the same reset-timeout cycle again.
    time.advance(1_000);
    expect(breaker.getState()).toBe('half_open');
  });

  it('limits concurrent half-open trials to halfOpenMaxAttempts', () => {
    const time = clock();
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      halfOpenMaxAttempts: 1,
      now: time.now,
    });

    breaker.onFailure();
    time.advance(1_000);

    expect(breaker.canRequest()).toBe(true);
    // A second concurrent trial is rejected until the first resolves.
    expect(breaker.canRequest()).toBe(false);
  });

  it('msUntilHalfOpen reports remaining time while open and 0 otherwise', () => {
    const time = clock();
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 5_000,
      now: time.now,
    });

    expect(breaker.msUntilHalfOpen()).toBe(0);

    breaker.onFailure();
    expect(breaker.msUntilHalfOpen()).toBe(5_000);

    time.advance(2_000);
    expect(breaker.msUntilHalfOpen()).toBe(3_000);
  });
});
