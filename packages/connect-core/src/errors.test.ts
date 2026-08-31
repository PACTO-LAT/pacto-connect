import { describe, expect, it } from 'vitest';
import {
  isRetryableError,
  PactoApiError,
  PactoAuthError,
  PactoCircuitOpenError,
  PactoRetryExhaustedError,
  PactoTimeoutError,
} from './errors.js';

describe('PactoTimeoutError', () => {
  it('is a PactoError with the network taxonomy code', () => {
    const error = new PactoTimeoutError('request_timeout', 'timed out');
    expect(error.code).toBe('PACTO_NETWORK');
    expect(error.name).toBe('PactoTimeoutError');
    expect(error.detailCode).toBe('request_timeout');
  });
});

describe('PactoRetryExhaustedError', () => {
  it('carries the number of attempts made', () => {
    const error = new PactoRetryExhaustedError('retry_budget_exhausted', 'gave up', 4);
    expect(error.code).toBe('PACTO_NETWORK');
    expect(error.attempts).toBe(4);
  });
});

describe('PactoCircuitOpenError', () => {
  it('carries an optional retryAfterMs', () => {
    const error = new PactoCircuitOpenError('circuit_open', 'breaker open', 5_000);
    expect(error.code).toBe('PACTO_NETWORK');
    expect(error.retryAfterMs).toBe(5_000);
  });

  it('retryAfterMs is undefined when not provided', () => {
    const error = new PactoCircuitOpenError('circuit_open', 'breaker open');
    expect(error.retryAfterMs).toBeUndefined();
  });
});

describe('isRetryableError', () => {
  it('treats PACTO_NETWORK, PACTO_UPSTREAM, PACTO_RATE_LIMIT, and PACTO_INTERNAL as retryable', () => {
    expect(isRetryableError(new PactoTimeoutError('t', 'm'))).toBe(true);
    expect(isRetryableError(new PactoApiError('u', 'm', { code: 'PACTO_UPSTREAM' }))).toBe(true);
    expect(isRetryableError(new PactoApiError('r', 'm', { code: 'PACTO_RATE_LIMIT' }))).toBe(true);
    expect(isRetryableError(new PactoApiError('i', 'm', { code: 'PACTO_INTERNAL' }))).toBe(true);
  });

  it('treats auth, validation, session, escrow, security, and unknown codes as non-retryable', () => {
    expect(isRetryableError(new PactoAuthError('a', 'm'))).toBe(false);
    expect(isRetryableError(new PactoApiError('v', 'm', { code: 'PACTO_VALIDATION' }))).toBe(false);
    expect(isRetryableError(new PactoApiError('s', 'm', { code: 'PACTO_SESSION' }))).toBe(false);
    expect(isRetryableError(new PactoApiError('e', 'm', { code: 'PACTO_ESCROW' }))).toBe(false);
    expect(isRetryableError(new PactoApiError('sec', 'm', { code: 'PACTO_SECURITY' }))).toBe(false);
    expect(isRetryableError(new PactoApiError('unk', 'm', { code: 'PACTO_UNKNOWN' }))).toBe(false);
  });

  it('treats a raw, unclassified thrown value as retryable', () => {
    expect(isRetryableError(new Error('network down'))).toBe(true);
    expect(isRetryableError('boom')).toBe(true);
    expect(isRetryableError(undefined)).toBe(true);
  });
});
