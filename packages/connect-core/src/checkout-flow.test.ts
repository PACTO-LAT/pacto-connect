import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutFlowController, type CheckoutFlowOptions } from './checkout-flow.js';
import {
  buildCheckoutSnapshotScope,
  type CheckoutSnapshot,
  checkoutStorageKey,
  createMemoryCheckoutStorage,
  serializeCheckoutSnapshot,
} from './checkout-storage.js';

const gatewayUrl = 'https://gateway.example';
const listingId = 'lst_1';
const publishableKey = 'pk_test_123';

const listing = {
  id: listingId,
  asset: 'USDC',
  amount: '100',
  price: '5000',
  side: 'buy' as const,
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const quote = {
  id: 'quo_1',
  listingId,
  asset: 'USDC',
  amount: '100',
  price: '5000',
  side: 'buy' as const,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const escrow = {
  id: 'esc_1',
  quoteId: quote.id,
  status: 'pending' as const,
  amount: '100',
  asset: 'USDC',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

function createFetchMock(testCalls: { url: string; method: string }[] = []) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/v1/session') && method === 'POST') {
      return jsonResponse({
        sessionId: 'sess_1',
        clientSecret: 'cs_sess_1.sig',
        expiresAt: '2099-01-01T00:00:00.000Z',
        mode: 'buy',
      });
    }

    if (url.includes(`/v1/listings/${listingId}`)) {
      return jsonResponse({ listing });
    }

    if (url.endsWith('/v1/quotes') && method === 'POST') {
      return jsonResponse({ quote });
    }

    if (url.endsWith('/v1/escrows') && method === 'POST') {
      return jsonResponse({ escrow });
    }

    if (url.includes('/v1/test/escrows/')) {
      testCalls.push({ url, method });
      return jsonResponse({ escrow: { ...escrow, status: 'released' } });
    }

    if (url.includes('/v1/escrows/events')) {
      return jsonResponse({});
    }

    return jsonResponse({ error: 'not found' }, 404);
  });
}

function buildPersistedSnapshot(overrides: Partial<CheckoutSnapshot> = {}): CheckoutSnapshot {
  const scope = buildCheckoutSnapshotScope({
    publishableKey,
    listingId,
    mode: 'buy',
  });

  return {
    version: 1,
    step: 'deposit',
    sessionId: 'sess_1',
    selectedListing: listing,
    quote,
    escrow,
    milestones: [],
    testMode: true,
    session: {
      sessionId: 'sess_1',
      clientSecret: 'cs_sess_1.sig',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mode: 'buy',
    },
    scope,
    ...overrides,
  };
}

type TestControllerOptions = Omit<
  CheckoutFlowOptions,
  'publishableKey' | 'gatewayUrl' | 'listingId'
>;

async function startTestController(
  publishableKeyValue: string,
  options: TestControllerOptions = {},
): Promise<CheckoutFlowController> {
  const controller = new CheckoutFlowController({
    publishableKey: publishableKeyValue,
    gatewayUrl,
    listingId,
    ...options,
  });

  await controller.start();
  return controller;
}

describe('CheckoutFlowController test controls', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'idem-key-123'),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forceTestRelease calls api.test.forceRelease with the current escrow id', async () => {
    const testCalls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', createFetchMock(testCalls));

    const controller = await startTestController('pk_test_123');
    expect(controller.getState().testMode).toBe(true);

    await controller.forceTestRelease();

    expect(testCalls).toContainEqual({
      url: expect.stringContaining('/v1/test/escrows/esc_1/release'),
      method: 'POST',
    });

    controller.destroy();
  });

  it('forceTestDispute calls api.test.forceDispute with the current escrow id', async () => {
    const testCalls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', createFetchMock(testCalls));

    const controller = await startTestController('pk_test_123');

    await controller.forceTestDispute('buyer_claim');

    expect(testCalls).toContainEqual({
      url: expect.stringContaining('/v1/test/escrows/esc_1/dispute'),
      method: 'POST',
    });

    controller.destroy();
  });

  it('forceTestTimeout calls api.test.forceTimeout with the current escrow id', async () => {
    const testCalls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', createFetchMock(testCalls));

    const controller = await startTestController('pk_test_123');

    await controller.forceTestTimeout();

    expect(testCalls).toContainEqual({
      url: expect.stringContaining('/v1/test/escrows/esc_1/timeout'),
      method: 'POST',
    });

    controller.destroy();
  });

  it('forceTest* methods no-op when not in test mode', async () => {
    const testCalls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', createFetchMock(testCalls));

    const controller = await startTestController('pk_live_123');
    expect(controller.getState().testMode).toBe(false);

    await controller.forceTestRelease();
    await controller.forceTestDispute();
    await controller.forceTestTimeout();

    expect(testCalls).toHaveLength(0);

    controller.destroy();
  });
});

describe('CheckoutFlowController persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'idem-key-123'),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resumes a valid persisted snapshot without creating a new session', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const storage = createMemoryCheckoutStorage();
    const scope = buildCheckoutSnapshotScope({
      publishableKey,
      listingId,
      mode: 'buy',
    });
    storage.setItem(checkoutStorageKey(scope), serializeCheckoutSnapshot(buildPersistedSnapshot()));

    const controller = await startTestController(publishableKey, { storage });

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/session'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(controller.getState().step).toBe('deposit');
    expect(controller.getState().quote?.id).toBe('quo_1');

    controller.destroy();
  });

  it('discards expired persisted snapshots and surfaces quote expiry', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    const storage = createMemoryCheckoutStorage();
    const scope = buildCheckoutSnapshotScope({
      publishableKey,
      listingId,
      mode: 'buy',
    });
    const now = Date.parse('2024-01-02T00:00:00.000Z');
    storage.setItem(
      checkoutStorageKey(scope),
      serializeCheckoutSnapshot(
        buildPersistedSnapshot({
          quote: { ...quote, expiresAt: '2024-01-01T23:59:59.000Z' },
        }),
      ),
    );

    const controller = await startTestController(publishableKey, {
      storage,
      now: () => now,
    });

    expect(controller.getState().step).toBe('error');
    expect(controller.getState().error?.name).toBe('CheckoutQuoteExpiredError');
    expect(storage.getItem(checkoutStorageKey(scope))).toBeNull();

    controller.destroy();
  });

  it('discards corrupt persisted snapshots without throwing', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const storage = createMemoryCheckoutStorage();
    const scope = buildCheckoutSnapshotScope({
      publishableKey,
      listingId,
      mode: 'buy',
    });
    storage.setItem(checkoutStorageKey(scope), '{bad-json');

    const controller = await startTestController(publishableKey, { storage });

    expect(controller.getState().step).toBe('deposit');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/session'),
      expect.objectContaining({ method: 'POST' }),
    );

    controller.destroy();
  });

  it('persists stable flow state after reaching deposit', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    const storage = createMemoryCheckoutStorage();
    const scope = buildCheckoutSnapshotScope({
      publishableKey,
      listingId,
      mode: 'buy',
    });

    const controller = await startTestController(publishableKey, { storage });
    const raw = storage.getItem(checkoutStorageKey(scope));
    expect(raw).toBeTruthy();
    expect(raw).toContain('"step":"deposit"');

    controller.destroy();
  });

  it('blocks confirmDeposit when the quote has expired', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/v1/session') && method === 'POST') {
        return jsonResponse({
          sessionId: 'sess_1',
          clientSecret: 'cs_sess_1.sig',
          expiresAt: '2099-01-01T00:00:00.000Z',
          mode: 'buy',
        });
      }

      if (url.includes(`/v1/listings/${listingId}`)) {
        return jsonResponse({ listing });
      }

      if (url.endsWith('/v1/quotes') && method === 'POST') {
        return jsonResponse({
          quote: { ...quote, expiresAt: '2024-01-01T00:00:00.000Z' },
        });
      }

      if (url.endsWith('/v1/escrows') && method === 'POST') {
        return jsonResponse({ escrow });
      }

      if (url.includes('/v1/escrows/') && method === 'POST') {
        throw new Error('deposit should not be called for expired quote');
      }

      return jsonResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = await startTestController(publishableKey, {
      now: () => Date.parse('2024-01-02T00:00:00.000Z'),
    });

    await controller.confirmDeposit();

    expect(controller.getState().step).toBe('error');
    expect(controller.getState().error?.name).toBe('CheckoutQuoteExpiredError');

    controller.destroy();
  });
});
