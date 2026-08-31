export const PACTO_ERROR_CODES = [
  'PACTO_AUTH',
  'PACTO_RATE_LIMIT',
  'PACTO_UPSTREAM',
  'PACTO_VALIDATION',
  'PACTO_SESSION',
  'PACTO_ESCROW',
  'PACTO_NETWORK',
  'PACTO_SECURITY',
  'PACTO_INTERNAL',
  'PACTO_UNKNOWN',
] as const;

/** Client-side security control detail codes surfaced on PactoSecurityError.detailCode */
export const SECURITY_DETAIL_CODES = [
  'link_state_missing',
  'link_state_invalid',
  'link_state_replayed',
  'link_state_malformed',
  'bridge_origin_rejected',
  'pin_mismatch',
  'pin_stale',
  'biometric_cancelled',
  'biometric_unavailable',
  'biometric_not_enrolled',
  'device_integrity_blocked',
] as const;

export type SecurityDetailCode = (typeof SECURITY_DETAIL_CODES)[number];

export function isSecurityDetailCode(value: unknown): value is SecurityDetailCode {
  return typeof value === 'string' && (SECURITY_DETAIL_CODES as readonly string[]).includes(value);
}

/** Gateway escrow_error detail codes surfaced on PactoEscrowError.detailCode */
export const ESCROW_DETAIL_CODES = [
  'escrow_not_found',
  'invalid_transition',
  'refund_exceeds_balance',
  'dispute_not_found',
] as const;

export type EscrowDetailCode = (typeof ESCROW_DETAIL_CODES)[number];

export function isEscrowDetailCode(value: unknown): value is EscrowDetailCode {
  return typeof value === 'string' && (ESCROW_DETAIL_CODES as readonly string[]).includes(value);
}

export type PactoErrorCode = (typeof PACTO_ERROR_CODES)[number];

export function isPactoErrorCode(value: unknown): value is PactoErrorCode {
  return typeof value === 'string' && (PACTO_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Taxonomy codes that represent a transient, retryable condition: the
 * gateway (or the network path to it) is temporarily unavailable rather than
 * the request itself being invalid. This is the single source of truth for
 * retryability — network modules classify errors through
 * {@link isRetryableErrorCode} (or {@link isRetryableError}, its
 * `PactoError`-aware counterpart in `errors.ts`) instead of inspecting HTTP
 * status codes locally.
 */
export const RETRYABLE_ERROR_CODES: readonly PactoErrorCode[] = [
  'PACTO_NETWORK',
  'PACTO_UPSTREAM',
  'PACTO_RATE_LIMIT',
  'PACTO_INTERNAL',
];

export function isRetryableErrorCode(code: PactoErrorCode): boolean {
  return (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);
}

export interface ClassifyInput {
  status?: number;
  type?: string;
  code?: string;
}

export function classifyGatewayError(input: ClassifyInput): PactoErrorCode {
  const { status, type, code } = input;

  if (type === 'session_error') {
    return 'PACTO_SESSION';
  }

  if (type === 'validation_error') {
    return 'PACTO_VALIDATION';
  }

  if (type === 'rate_limit_error' || status === 429) {
    return 'PACTO_RATE_LIMIT';
  }

  if (type === 'auth_error' || status === 401 || status === 403) {
    return 'PACTO_AUTH';
  }

  if (type === 'escrow_error') {
    return 'PACTO_ESCROW';
  }

  if (
    code === 'not_implemented' ||
    status === 501 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return 'PACTO_UPSTREAM';
  }

  if (status !== undefined && status >= 500) {
    return 'PACTO_INTERNAL';
  }

  if (status !== undefined && status >= 400) {
    return status === 400 ? 'PACTO_VALIDATION' : 'PACTO_UNKNOWN';
  }

  return 'PACTO_UNKNOWN';
}

export const REQUEST_ID_HEADER = 'x-pacto-request-id';

export function generateRequestId(): string {
  return `req_${globalThis.crypto.randomUUID()}`;
}
