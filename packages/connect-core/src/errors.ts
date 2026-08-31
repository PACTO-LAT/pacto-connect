import type { GatewayErrorBody } from './api-types.js';
import {
  classifyGatewayError,
  isPactoErrorCode,
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

  if (
    context.resource === 'escrow' ||
    context.path.includes('/escrows') ||
    type === 'escrow_error'
  ) {
    return new PactoEscrowError(detailCode, message, options);
  }

  if (type === 'api_error' || status >= 400) {
    return new PactoApiError(detailCode, message, { ...options, code: taxonomyCode });
  }

  return new PactoError(type, taxonomyCode, detailCode, message, options);
}
