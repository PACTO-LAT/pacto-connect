import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, PactoFxQuote, PactoSession, VERSION } from './index';

const gatewayUrl = 'https://gateway.example';
const publishableKey = 'pk_test_123';
const origin = 'https://allowed.example';

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('@pacto-connect/core', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('init throws without a publishableKey', () => {
    // @ts-expect-error intentionally missing required option
    expect(() => init({})).toThrow(/publishableKey is required/);
  });

  it('init returns a client with the default gateway url', () => {
    const client = init({ publishableKey: 'pk_test_123' });
    expect(client.publishableKey).toBe('pk_test_123');
    expect(client.gatewayUrl).toContain('http');
  });
});

describe('@pacto-connect/core sessions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a checkout session', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(200, {
        sessionId: 'session_1',
        clientSecret: 'cs_session_1_signature',
        expiresAt: '2024-01-01T00:15:00.000Z',
        mode: 'buy',
      }) as Response,
    );

    const client = init({ publishableKey, gatewayUrl, origin });
    const session = await client.createCheckoutSession({
      listingId: 'listing_1',
      mode: 'buy',
    });

    expect(session).toBeInstanceOf(PactoSession);
    expect(session.sessionId).toBe('session_1');
    expect(session.clientSecret).toBe('cs_session_1_signature');
    expect(session.mode).toBe('buy');
    expect(session.isExpired()).toBe(true);
  });

  it('maps invalid session errors from the gateway', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(401, {
        error: {
          type: 'session_error',
          code: 'session_invalid',
          message: 'Client secret signature mismatch',
        },
      }) as Response,
    );

    const client = init({ publishableKey, gatewayUrl, origin });

    await expect(
      client.createCheckoutSession({ listingId: 'listing_1', mode: 'buy' }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'PactoSessionError',
        code: 'session_invalid',
      }),
    );
  });

  it('maps expired session errors from the gateway', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          sessionId: 'session_1',
          clientSecret: 'cs_session_1_signature',
          expiresAt: '2024-01-01T00:15:00.000Z',
          mode: 'buy',
        }) as Response,
      )
      .mockResolvedValueOnce(
        mockFetchResponse(410, {
          error: {
            type: 'session_error',
            code: 'session_expired',
            message: 'Session has expired',
          },
        }) as Response,
      );

    const client = init({ publishableKey, gatewayUrl, origin });
    const session = await client.createCheckoutSession({
      listingId: 'listing_1',
      mode: 'buy',
    });

    await expect(session.refresh()).rejects.toEqual(
      expect.objectContaining({
        name: 'PactoSessionError',
        code: 'session_expired',
      }),
    );
  });

  it('refreshes a checkout session', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          sessionId: 'session_1',
          clientSecret: 'cs_session_1_signature',
          expiresAt: '2024-01-01T00:15:00.000Z',
          mode: 'buy',
        }) as Response,
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          sessionId: 'session_1',
          clientSecret: 'cs_session_1_new_signature',
          expiresAt: '2024-01-01T00:30:00.000Z',
          mode: 'sell',
        }) as Response,
      );

    const client = init({ publishableKey, gatewayUrl, origin });
    const session = await client.createCheckoutSession({
      listingId: 'listing_1',
      mode: 'buy',
    });
    const refreshed = await session.refresh();

    expect(refreshed.clientSecret).toBe('cs_session_1_new_signature');
    expect(refreshed.mode).toBe('sell');
  });
});

describe('@pacto-connect/core getQuote', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a signed FX quote', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(200, {
        quote: {
          quoteId: 'qt_1',
          from: 'USD',
          to: 'CRC',
          amount: 100,
          baseRate: 510,
          spreadBps: 100,
          effectiveRate: 504.9,
          toAmount: 50490,
          source: 'static',
          asOf: '2025-06-01T00:00:00.000Z',
          expiresAt: '2099-01-01T00:00:00.000Z',
          token: 'encoded.signature',
        },
      }) as Response,
    );

    const client = init({ publishableKey, gatewayUrl, origin });
    const quote = await client.getQuote({ from: 'USD', to: 'CRC', amount: 100 });

    expect(quote).toBeInstanceOf(PactoFxQuote);
    expect(quote.quoteId).toBe('qt_1');
    expect(quote.effectiveRate).toBe(504.9);
    expect(quote.token).toBe('encoded.signature');
    expect(quote.expiresAt).toBeInstanceOf(Date);
    expect(quote.isExpired()).toBe(false);

    const firstCall = vi.mocked(fetch).mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatch(/\/v1\/quote$/);
    expect(firstCall?.[1]?.method).toBe('POST');
  });

  it('reports expired quotes via isExpired', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(200, {
        quote: {
          quoteId: 'qt_1',
          from: 'USD',
          to: 'CRC',
          amount: 100,
          baseRate: 510,
          spreadBps: 100,
          effectiveRate: 504.9,
          toAmount: 50490,
          source: 'static',
          asOf: '2025-06-01T00:00:00.000Z',
          expiresAt: '2000-01-01T00:00:00.000Z',
          token: 'encoded.signature',
        },
      }) as Response,
    );

    const client = init({ publishableKey, gatewayUrl, origin });
    const quote = await client.getQuote({ from: 'USD', to: 'CRC', amount: 100 });

    expect(quote.isExpired()).toBe(true);
  });

  it('maps gateway errors from getQuote', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(400, {
        error: {
          type: 'validation_error',
          code: 'unsupported_currency',
          message: 'from must be one of CRC, MXN, USD',
        },
      }) as Response,
    );

    const client = init({ publishableKey, gatewayUrl, origin });

    await expect(client.getQuote({ from: 'USD', to: 'CRC', amount: 100 })).rejects.toMatchObject({
      code: 'unsupported_currency',
    });
  });

  it('throws on an invalid quote payload', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(200, {
        quote: { quoteId: 'qt_1' },
      }) as Response,
    );

    const client = init({ publishableKey, gatewayUrl, origin });

    await expect(client.getQuote({ from: 'USD', to: 'CRC', amount: 100 })).rejects.toThrow(
      /invalid quote payload/,
    );
  });
});
