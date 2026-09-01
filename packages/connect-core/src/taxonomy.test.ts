import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyGatewayError,
  ESCROW_DETAIL_CODES,
  generateRequestId,
  isEscrowDetailCode,
  isPactoErrorCode,
  isSecurityDetailCode,
  PACTO_ERROR_CODES,
  SECURITY_DETAIL_CODES,
} from './taxonomy.js';

describe('isPactoErrorCode', () => {
  it('accepts known taxonomy codes', () => {
    for (const code of PACTO_ERROR_CODES) {
      expect(isPactoErrorCode(code)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isPactoErrorCode('session_expired')).toBe(false);
    expect(isPactoErrorCode(undefined)).toBe(false);
    expect(isPactoErrorCode(null)).toBe(false);
  });
});

describe('classifyGatewayError', () => {
  it('maps session_error ahead of auth status codes', () => {
    expect(classifyGatewayError({ type: 'session_error', status: 401 })).toBe('PACTO_SESSION');
  });

  it('maps validation_error', () => {
    expect(classifyGatewayError({ type: 'validation_error', status: 401 })).toBe(
      'PACTO_VALIDATION',
    );
  });

  it('maps 429 and rate_limit_error to PACTO_RATE_LIMIT', () => {
    expect(classifyGatewayError({ status: 429 })).toBe('PACTO_RATE_LIMIT');
    expect(classifyGatewayError({ type: 'rate_limit_error' })).toBe('PACTO_RATE_LIMIT');
  });

  it('maps auth_error and 401/403 to PACTO_AUTH', () => {
    expect(classifyGatewayError({ type: 'auth_error' })).toBe('PACTO_AUTH');
    expect(classifyGatewayError({ status: 401 })).toBe('PACTO_AUTH');
    expect(classifyGatewayError({ status: 403 })).toBe('PACTO_AUTH');
  });

  it('maps escrow_error to PACTO_ESCROW', () => {
    expect(classifyGatewayError({ type: 'escrow_error' })).toBe('PACTO_ESCROW');
  });

  it('maps risk_error to PACTO_RISK', () => {
    expect(classifyGatewayError({ type: 'risk_error' })).toBe('PACTO_RISK');
  });

  it('exports escrow detail codes for SDK consumers', () => {
    expect(ESCROW_DETAIL_CODES).toContain('invalid_transition');
    expect(ESCROW_DETAIL_CODES).toContain('refund_exceeds_balance');
    expect(isEscrowDetailCode('escrow_not_found')).toBe(true);
    expect(isEscrowDetailCode('unknown')).toBe(false);
  });

  it('exports security detail codes for SDK consumers', () => {
    expect(PACTO_ERROR_CODES).toContain('PACTO_SECURITY');
    expect(SECURITY_DETAIL_CODES).toContain('pin_mismatch');
    expect(SECURITY_DETAIL_CODES).toContain('link_state_replayed');
    expect(isSecurityDetailCode('biometric_cancelled')).toBe(true);
    expect(isSecurityDetailCode('unknown')).toBe(false);
  });

  it('maps not_implemented and 501-504 to PACTO_UPSTREAM', () => {
    expect(classifyGatewayError({ code: 'not_implemented' })).toBe('PACTO_UPSTREAM');
    expect(classifyGatewayError({ status: 501 })).toBe('PACTO_UPSTREAM');
    expect(classifyGatewayError({ status: 502 })).toBe('PACTO_UPSTREAM');
    expect(classifyGatewayError({ status: 503 })).toBe('PACTO_UPSTREAM');
    expect(classifyGatewayError({ status: 504 })).toBe('PACTO_UPSTREAM');
  });

  it('maps other 5xx to PACTO_INTERNAL', () => {
    expect(classifyGatewayError({ status: 500 })).toBe('PACTO_INTERNAL');
  });

  it('maps 400 to PACTO_VALIDATION and other 4xx to PACTO_UNKNOWN', () => {
    expect(classifyGatewayError({ status: 400 })).toBe('PACTO_VALIDATION');
    expect(classifyGatewayError({ status: 404 })).toBe('PACTO_UNKNOWN');
  });

  it('maps unknown input to PACTO_UNKNOWN', () => {
    expect(classifyGatewayError({})).toBe('PACTO_UNKNOWN');
  });
});

describe('generateRequestId', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => '11111111-2222-3333-4444-555555555555'),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns req_<uuid>', () => {
    expect(generateRequestId()).toBe('req_11111111-2222-3333-4444-555555555555');
  });
});
