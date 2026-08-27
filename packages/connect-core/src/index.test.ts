import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from './index';
import { init, PactoSession, VERSION } from './index';

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
  it('exposes a stable public export surface', () => {
    const exportNames = Object.keys(core).sort();
    expect(exportNames).toMatchInlineSnapshot(`
      [
        "CHECKOUT_SNAPSHOT_VERSION",
        "CheckoutFlowController",
        "CheckoutQuoteExpiredError",
        "DEFAULT_GATEWAY_URL",
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
        "PactoError",
        "PactoEscrowError",
        "PactoRateLimitError",
        "PactoSecurityError",
        "PactoSession",
        "PactoSessionError",
        "RAIL_ADAPTER_CONTRACT_VERSION",
        "REQUEST_ID_HEADER",
        "RailError",
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
        "isCheckoutSnapshotExpired",
        "isEscrowDetailCode",
        "isOriginAllowed",
        "isPactoBridgeEnvelope",
        "isPactoErrorCode",
        "isPersistableStep",
        "isQuoteExpired",
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
