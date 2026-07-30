import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  errorFromResponse,
  PactoApiError,
  PactoAuthError,
  PactoEscrowError,
  PactoRateLimitError,
  PactoSessionError,
} from './errors.js';
import { IDEMPOTENCY_KEY_HEADER, request } from './http.js';
import { REQUEST_ID_HEADER } from './taxonomy.js';

const gatewayUrl = 'https://gateway.example';
const publishableKey = 'pk_test_123';
const clientSecret = 'cs_session_1.signature';

function mockFetchResponse(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

describe('errorFromResponse', () => {
  it('maps 401 to PactoAuthError', () => {
    const error = errorFromResponse(
      401,
      { error: { code: 'unauthorized', message: 'nope' } },
      {
        path: '/v1/listings',
      },
    );
    expect(error).toBeInstanceOf(PactoAuthError);
    expect(error.code).toBe('PACTO_AUTH');
    expect(error.detailCode).toBe('unauthorized');
  });

  it('maps 403 to PactoAuthError', () => {
    const error = errorFromResponse(
      403,
      { error: { code: 'forbidden', message: 'nope' } },
      {
        path: '/v1/listings',
      },
    );
    expect(error).toBeInstanceOf(PactoAuthError);
  });

  it('maps 429 to PactoRateLimitError with retryAfter', () => {
    const headers = new Headers({ 'Retry-After': '2' });
    const error = errorFromResponse(
      429,
      { error: { code: 'rate_limited', message: 'slow down' } },
      { path: '/v1/quotes' },
      headers,
    );
    expect(error).toBeInstanceOf(PactoRateLimitError);
    expect(error.code).toBe('PACTO_RATE_LIMIT');
    expect((error as PactoRateLimitError).retryAfter).toBe(2000);
  });

  it('maps escrow errors to PactoEscrowError', () => {
    const error = errorFromResponse(
      400,
      { error: { type: 'escrow_error', code: 'invalid_state', message: 'bad escrow' } },
      { path: '/v1/escrows', resource: 'escrow' },
    );
    expect(error).toBeInstanceOf(PactoEscrowError);
    expect(error.code).toBe('PACTO_ESCROW');
    expect(error.detailCode).toBe('invalid_state');
  });

  it('maps other errors to PactoApiError', () => {
    const error = errorFromResponse(
      400,
      { error: { code: 'bad_request', message: 'invalid' } },
      {
        path: '/v1/listings',
      },
    );
    expect(error).toBeInstanceOf(PactoApiError);
    expect(error.code).toBe('PACTO_VALIDATION');
    expect(error.detailCode).toBe('bad_request');
  });

  it('maps session errors to PactoSessionError', () => {
    const error = errorFromResponse(
      401,
      {
        error: {
          type: 'session_error',
          code: 'session_expired',
          message: 'expired',
        },
      },
      { path: '/v1/session' },
    );
    expect(error).toBeInstanceOf(PactoSessionError);
    expect(error.code).toBe('PACTO_SESSION');
    expect(error.detailCode).toBe('session_expired');
  });

  it('uses pactoCode from the body when valid', () => {
    const error = errorFromResponse(
      400,
      {
        error: {
          code: 'bad_request',
          message: 'invalid',
          pactoCode: 'PACTO_INTERNAL',
        },
      },
      { path: '/v1/listings' },
    );
    expect(error).toBeInstanceOf(PactoApiError);
    expect(error.code).toBe('PACTO_INTERNAL');
  });

  it('classifies when pactoCode is absent', () => {
    const error = errorFromResponse(
      501,
      { error: { code: 'not_ready', message: 'upstream' } },
      { path: '/v1/listings' },
    );
    expect(error).toBeInstanceOf(PactoApiError);
    expect(error.code).toBe('PACTO_UPSTREAM');
  });

  it('picks up requestId from the body', () => {
    const error = errorFromResponse(
      400,
      {
        error: {
          code: 'bad_request',
          message: 'invalid',
          requestId: 'req_from_body',
        },
      },
      { path: '/v1/listings' },
    );
    expect(error.requestId).toBe('req_from_body');
  });

  it('falls back to the request-id header', () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: 'req_from_header' });
    const error = errorFromResponse(
      400,
      { error: { code: 'bad_request', message: 'invalid' } },
      { path: '/v1/listings' },
      headers,
    );
    expect(error.requestId).toBe('req_from_header');
  });

  it('falls back to the passed fallbackRequestId', () => {
    const error = errorFromResponse(
      400,
      { error: { code: 'bad_request', message: 'invalid' } },
      { path: '/v1/listings' },
      undefined,
      'req_fallback',
    );
    expect(error.requestId).toBe('req_fallback');
  });
});

describe('http request', () => {
  const sleep = vi.fn(async () => {});
  let uuidCounter = 0;

  beforeEach(() => {
    uuidCounter = 0;
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => {
        uuidCounter += 1;
        return `uuid-${uuidCounter}`;
      }),
    });
    sleep.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not send Idempotency-Key on GET requests', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { listings: [] }) as Response);

    await request(
      { gatewayUrl, publishableKey, clientSecret, sleep },
      { method: 'GET', path: '/v1/listings' },
    );

    const firstCall = vi.mocked(fetch).mock.calls[0];
    const options = firstCall?.[1];
    const headers = options?.headers as Record<string, string>;
    expect(headers[IDEMPOTENCY_KEY_HEADER]).toBeUndefined();
  });

  it('sends x-pacto-request-id on every request', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { listings: [] }) as Response);

    await request(
      { gatewayUrl, publishableKey, clientSecret, sleep },
      { method: 'GET', path: '/v1/listings' },
    );

    const firstCall = vi.mocked(fetch).mock.calls[0];
    const headers = firstCall?.[1]?.headers as Record<string, string>;
    expect(headers[REQUEST_ID_HEADER]).toBe('req_uuid-1');
  });

  it('reuses the same Idempotency-Key across retries', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(500, { error: { code: 'server_error', message: 'fail' } }) as Response,
      )
      .mockResolvedValueOnce(mockFetchResponse(200, { escrow: { id: 'escrow_1' } }) as Response);

    await request(
      { gatewayUrl, publishableKey, clientSecret, maxRetries: 1, sleep },
      {
        method: 'POST',
        path: '/v1/escrows',
        body: { quoteId: 'quote_1' },
        idempotent: true,
        resource: 'escrow',
      },
    );

    const firstCall = vi.mocked(fetch).mock.calls[0];
    const secondCall = vi.mocked(fetch).mock.calls[1];
    const firstHeaders = firstCall?.[1]?.headers as Record<string, string>;
    const secondHeaders = secondCall?.[1]?.headers as Record<string, string>;
    expect(firstHeaders[IDEMPOTENCY_KEY_HEADER]).toBe('uuid-1');
    expect(secondHeaders[IDEMPOTENCY_KEY_HEADER]).toBe('uuid-1');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('reuses the same x-pacto-request-id across retries', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(500, { error: { code: 'server_error', message: 'fail' } }) as Response,
      )
      .mockResolvedValueOnce(mockFetchResponse(200, { escrow: { id: 'escrow_1' } }) as Response);

    await request(
      { gatewayUrl, publishableKey, clientSecret, maxRetries: 1, sleep },
      {
        method: 'POST',
        path: '/v1/escrows',
        body: { quoteId: 'quote_1' },
        idempotent: true,
        resource: 'escrow',
      },
    );

    const firstHeaders = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = vi.mocked(fetch).mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders[REQUEST_ID_HEADER]).toBe('req_uuid-2');
    expect(secondHeaders[REQUEST_ID_HEADER]).toBe('req_uuid-2');
    expect(firstHeaders[REQUEST_ID_HEADER]).toBe(secondHeaders[REQUEST_ID_HEADER]);
  });

  it('does not retry on non-retryable 4xx errors', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(400, { error: { code: 'bad_request', message: 'invalid' } }) as Response,
    );

    await expect(
      request(
        { gatewayUrl, publishableKey, clientSecret, maxRetries: 3, sleep },
        { method: 'POST', path: '/v1/quotes', body: { asset: 'USDC' }, idempotent: true },
      ),
    ).rejects.toBeInstanceOf(PactoApiError);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries network failures and eventually throws PactoApiError', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    const error = await request(
      { gatewayUrl, publishableKey, clientSecret, maxRetries: 2, sleep },
      { method: 'GET', path: '/v1/listings' },
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PactoApiError);
    expect((error as PactoApiError).code).toBe('PACTO_NETWORK');
    expect((error as PactoApiError).detailCode).toBe('network_error');
    expect((error as PactoApiError).requestId).toBe('req_uuid-1');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('maps auth errors from the gateway', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(401, { error: { code: 'unauthorized', message: 'bad token' } }) as Response,
    );

    await expect(
      request(
        { gatewayUrl, publishableKey, clientSecret, sleep },
        { method: 'GET', path: '/v1/listings' },
      ),
    ).rejects.toBeInstanceOf(PactoAuthError);
  });
});
