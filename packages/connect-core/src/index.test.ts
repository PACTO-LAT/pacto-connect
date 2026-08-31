import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PactoApiError, PactoCircuitOpenError, PactoRetryExhaustedError } from './errors';
import * as core from './index';
import { init, PactoSession, VERSION } from './index';

const gatewayUrl = 'https://gateway.example';
const publishableKey = 'pk_test_123';
const origin = 'https://allowed.example';

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  };
}

describe('@pacto-connect/core', () => {
  it('exposes a stable public export surface', () => {
    const exportNames = Object.keys(core).sort();
    expect(exportNames).toMatchInlineSnapshot(`
      [
        "CHECKOUT_SNAPSHOT_VERSION",
        "CheckoutFlowController",
        "CheckoutQuoteExpiredError",
        "CircuitBreaker",
        "DEFAULT_BRIDGE_MESSAGE_TIMEOUT_MS",
        "DEFAULT_CIRCUIT_BREAKER_CONFIG",
        "DEFAULT_GATEWAY_URL",
        "DEFAULT_RESILIENCE_CONFIG",
        "DEFAULT_THEME",
        "ESCROW_DETAIL_CODES",
        "ESCROW_EVENT_NAMES",
        "IllegalCheckoutTransitionError",
        "PACTO_BRIDGE_SOURCE",
        "PACTO_BRIDGE_VERSION",
        "PACTO_ERROR_CODES",
        "Pacto",
        "PactoApiError",
        "PactoAuthError",
        "PactoCircuitOpenError",
        "PactoError",
        "PactoEscrowError",
        "PactoRateLimitError",
        "PactoRetryExhaustedError",
        "PactoSecurityError",
        "PactoSession",
        "PactoSessionError",
        "PactoTimeoutError",
        "RAIL_ADAPTER_CONTRACT_VERSION",
        "REQUEST_ID_HEADER",
        "RETRYABLE_ERROR_CODES",
        "RailError",
        "ResiliencePolicy",
        "RetryBudget",
        "SECURITY_DETAIL_CODES",
        "STYLE_ELEMENT_ID",
        "VERSION",
        "applyCheckoutTransition",
        "assertPaymentRailConformance",
        "buildCheckoutSnapshotScope",
        "buildCheckoutStylesheet",
        "canTransition",
        "checkoutStorageKey",
        "classifyGatewayError",
        "computeBackoffDelay",
        "createBridgeClient",
        "createBridgeHost",
        "createDefaultPaymentRailRegistry",
        "createInitialCheckoutState",
        "createMemoryCheckoutStorage",
        "createPaymentRailRegistry",
        "createSinpeRail",
        "createSpeiRail",
        "createWebCheckoutStorage",
        "enMessages",
        "esMessages",
        "formatMessage",
        "generateRequestId",
        "init",
        "isBridgeMessageOfType",
        "isCheckoutSnapshotExpired",
        "isEscrowDetailCode",
        "isOriginAllowed",
        "isPactoBridgeEnvelope",
        "isPactoErrorCode",
        "isPersistableStep",
        "isQuoteExpired",
        "isRetryableError",
        "isRetryableErrorCode",
        "isSecurityDetailCode",
        "isTerminalCheckoutStep",
        "isTestMode",
        "keyMode",
        "parseCheckoutSnapshot",
        "resolveMessages",
        "serializeCheckoutSnapshot",
        "sinpeRail",
        "snapshotMatchesScope",
        "speiRail",
        "themeToCssVars",
        "waitForBridgeMessage",
        "withTimeout",
      ]
    `);
  });

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
        code: 'PACTO_SESSION',
        detailCode: 'session_invalid',
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
        code: 'PACTO_SESSION',
        detailCode: 'session_expired',
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

describe('@pacto-connect/core resilience configuration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries a transient failure on session creation using the default policy', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(503, { error: { code: 'unavailable', message: 'down' } }) as Response,
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          sessionId: 'session_1',
          clientSecret: 'cs_session_1_signature',
          expiresAt: '2099-01-01T00:00:00.000Z',
          mode: 'buy',
        }) as Response,
      );

    const client = init({ publishableKey, gatewayUrl, origin, baseDelayMs: 1 });
    const session = await client.createCheckoutSession({ listingId: 'listing_1', mode: 'buy' });

    expect(session.sessionId).toBe('session_1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares a session-wide retry budget and circuit breaker across every api() call for a session', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          sessionId: 'session_1',
          clientSecret: 'cs_session_1_signature',
          expiresAt: '2099-01-01T00:00:00.000Z',
          mode: 'buy',
        }) as Response,
      )
      .mockResolvedValue(
        mockFetchResponse(503, { error: { code: 'unavailable', message: 'down' } }) as Response,
      );

    const client = init({
      publishableKey,
      gatewayUrl,
      origin,
      maxRetries: 0,
      breaker: { failureThreshold: 1 },
    });
    const session = await client.createCheckoutSession({ listingId: 'listing_1', mode: 'buy' });

    // First request trips the breaker (single failure, threshold 1).
    await expect(client.api(session).listings.list()).rejects.toBeInstanceOf(PactoApiError);

    // A second, unrelated call obtained via a *fresh* `client.api(session)`
    // call still shares the same underlying policy — proving the breaker
    // (and budget) are scoped to the client/session, not to one api()
    // handle — and is rejected fast without a new fetch.
    vi.mocked(fetch).mockClear();
    await expect(client.api(session).quotes.retrieve('quo_1')).rejects.toBeInstanceOf(
      PactoCircuitOpenError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exhausts the session-wide retry budget across multiple api() calls with a typed error', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          sessionId: 'session_1',
          clientSecret: 'cs_session_1_signature',
          expiresAt: '2099-01-01T00:00:00.000Z',
          mode: 'buy',
        }) as Response,
      )
      .mockResolvedValueOnce(
        mockFetchResponse(503, { error: { code: 'unavailable', message: 'down' } }) as Response,
      )
      .mockResolvedValueOnce(mockFetchResponse(200, { listings: [] }) as Response)
      .mockResolvedValue(
        mockFetchResponse(503, { error: { code: 'unavailable', message: 'down' } }) as Response,
      );

    const client = init({
      publishableKey,
      gatewayUrl,
      origin,
      maxRetries: 5,
      retryBudget: 1,
      baseDelayMs: 1,
    });
    const session = await client.createCheckoutSession({ listingId: 'listing_1', mode: 'buy' });

    // First call fails once, retries (consuming the only shared budget
    // unit), then succeeds.
    await expect(client.api(session).listings.list()).resolves.toEqual({ listings: [] });

    // Second call's first retry finds the shared budget already exhausted.
    await expect(client.api(session).quotes.retrieve('quo_1')).rejects.toBeInstanceOf(
      PactoRetryExhaustedError,
    );
  });

  it('surfaces escrow event stream failures via PactoSession.onStreamError instead of failing silently', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(500, {}) as Response);

    const client = init({
      publishableKey,
      gatewayUrl,
      origin,
      maxReconnectAttempts: 1,
      baseDelayMs: 1,
    });
    const session = client.resumeCheckoutSession({
      sessionId: 'session_1',
      clientSecret: 'cs_session_1_signature',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      mode: 'buy',
    });

    const onStreamError = vi.fn();
    session.onStreamError(onStreamError);
    session.on('released', vi.fn());

    await vi.waitFor(() => expect(onStreamError).toHaveBeenCalled());
    expect(onStreamError).toHaveBeenCalledWith(expect.any(Error));

    session.closeEvents();
  });
});
