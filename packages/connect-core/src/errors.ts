import type { GatewayErrorBody } from './api-types.js';
import {
  classifyGatewayError,
  isPactoErrorCode,
  isRetryableErrorCode,
  type PactoErrorCode,
  REQUEST_ID_HEADER,
} from './taxonomy.js';

export type { GatewayErrorBody };

export interface ErrorContext {
  path: string;
  resource?: 'escrow' | 'quote' | 'listing' | 'subscription';
}

export interface PactoErrorOptions {
  requestId?: string;
}

export class PactoError extends Error {
  readonly type: string;
  readonly code: PactoErrorCode;
  readonly detailCode: string;
  readonly requestId?: string;

  constructor(
    type: string,
    code: PactoErrorCode,
    detailCode: string,
    message: string,
    options?: PactoErrorOptions,
  ) {
    super(message);
    this.name = 'PactoError';
    this.type = type;
    this.code = code;
    this.detailCode = detailCode;
    this.requestId = options?.requestId;
  }
}

export class PactoSessionError extends PactoError {
  constructor(
    detailCode: 'session_invalid' | 'session_expired',
    message: string,
    options?: PactoErrorOptions,
  ) {
    super('session_error', 'PACTO_SESSION', detailCode, message, options);
    this.name = 'PactoSessionError';
  }
}

export class PactoAuthError extends PactoError {
  constructor(detailCode: string, message: string, options?: PactoErrorOptions) {
    super('auth_error', 'PACTO_AUTH', detailCode, message, options);
    this.name = 'PactoAuthError';
  }
}

export class PactoRateLimitError extends PactoError {
  readonly retryAfter?: number;

  constructor(
    detailCode: string,
    message: string,
    retryAfter?: number,
    options?: PactoErrorOptions,
  ) {
    super('rate_limit_error', 'PACTO_RATE_LIMIT', detailCode, message, options);
    this.name = 'PactoRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class PactoEscrowError extends PactoError {
  constructor(detailCode: string, message: string, options?: PactoErrorOptions) {
    super('escrow_error', 'PACTO_ESCROW', detailCode, message, options);
    this.name = 'PactoEscrowError';
  }
}

export class PactoApiError extends PactoError {
  constructor(
    detailCode: string,
    message: string,
    options?: PactoErrorOptions & { code?: PactoErrorCode },
  ) {
    super('api_error', options?.code ?? 'PACTO_UNKNOWN', detailCode, message, options);
    this.name = 'PactoApiError';
  }
}

export class PactoSecurityError extends PactoError {
  constructor(detailCode: string, message: string, options?: PactoErrorOptions) {
    super('security_error', 'PACTO_SECURITY', detailCode, message, options);
    this.name = 'PactoSecurityError';
  }
}

/** A single attempt exceeded the resilience policy's per-attempt timeout. */
export class PactoTimeoutError extends PactoError {
  constructor(detailCode: string, message: string, options?: PactoErrorOptions) {
    super('timeout_error', 'PACTO_NETWORK', detailCode, message, options);
    this.name = 'PactoTimeoutError';
  }
}

/**
 * The session-wide retry budget was exhausted before this call could
 * succeed — surfaced instead of retrying silently forever or failing with
 * the last transient error, so an integrator can distinguish "the gateway is
 * degraded and we gave up" from an ordinary request failure.
 */
export class PactoRetryExhaustedError extends PactoError {
  /** Total attempts made (including the initial one) before giving up. */
  readonly attempts: number;

  constructor(detailCode: string, message: string, attempts: number, options?: PactoErrorOptions) {
    super('retry_exhausted_error', 'PACTO_NETWORK', detailCode, message, options);
    this.name = 'PactoRetryExhaustedError';
    this.attempts = attempts;
  }
}

/** The resilience policy's circuit breaker is open; the request was rejected without being attempted. */
export class PactoCircuitOpenError extends PactoError {
  /** Milliseconds until the breaker becomes eligible for a half-open trial, if known. */
  readonly retryAfterMs?: number;

  constructor(
    detailCode: string,
    message: string,
    retryAfterMs?: number,
    options?: PactoErrorOptions,
  ) {
    super('circuit_open_error', 'PACTO_NETWORK', detailCode, message, options);
    this.name = 'PactoCircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Taxonomy-driven retryability check used by every network module's
 * resilience policy — the single place that decides whether an error
 * represents a transient failure worth retrying. An error not recognized as
 * a `PactoError` (e.g. a raw exception thrown by `fetch`) is treated as
 * retryable, matching historical behavior for unclassified network failures.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof PactoError) {
    return isRetryableErrorCode(error.code);
  }
  return true;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get('Retry-After');
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

export function errorFromResponse(
  status: number,
  body: GatewayErrorBody,
  context: ErrorContext,
  headers?: Headers,
  fallbackRequestId?: string,
): PactoError {
  const detailCode = body.error?.code ?? 'unknown_error';
  const type = body.error?.type ?? 'gateway_error';
  const message = body.error?.message ?? `Gateway request failed with status ${status}`;
  const requestId =
    body.error?.requestId ?? headers?.get(REQUEST_ID_HEADER) ?? fallbackRequestId ?? undefined;
  const options: PactoErrorOptions | undefined = requestId ? { requestId } : undefined;
  const taxonomyCode = isPactoErrorCode(body.error?.pactoCode)
    ? body.error.pactoCode
    : classifyGatewayError({ status, type, code: detailCode });

  if (
    type === 'session_error' &&
    (detailCode === 'session_invalid' || detailCode === 'session_expired')
  ) {
    return new PactoSessionError(detailCode, message, options);
  }

  if (status === 401 || status === 403) {
    return new PactoAuthError(detailCode, message, options);
  }

  if (status === 429) {
    const retryAfter = headers ? parseRetryAfter(headers) : undefined;
    return new PactoRateLimitError(detailCode, message, retryAfter, options);
  }

  // An escrow-domain business-rule violation (invalid transition, refund
  // exceeds balance, ...) is never retryable — but a 5xx on an escrow
  // endpoint is a transport/server failure like any other, not a domain
  // error, and must fall through to the retryable classification below.
  if (
    type === 'escrow_error' ||
    ((context.resource === 'escrow' || context.path.includes('/escrows')) && status < 500)
  ) {
    return new PactoEscrowError(detailCode, message, options);
  }

  if (type === 'api_error' || status >= 400) {
    return new PactoApiError(detailCode, message, { ...options, code: taxonomyCode });
  }

  return new PactoError(type, taxonomyCode, detailCode, message, options);
}
