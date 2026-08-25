import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCheckoutSnapshotScope,
  type CheckoutSnapshot,
  checkoutStorageKey,
  createMemoryCheckoutStorage,
  createWebCheckoutStorage,
  isCheckoutSnapshotExpired,
  parseCheckoutSnapshot,
  serializeCheckoutSnapshot,
  snapshotMatchesScope,
} from './checkout-storage.js';

const scope = buildCheckoutSnapshotScope({
  publishableKey: 'pk_test_123',
  listingId: 'lst_1',
  mode: 'buy',
});

const snapshot: CheckoutSnapshot = {
  version: 1,
  step: 'deposit',
  sessionId: 'sess_1',
  selectedListing: {
    id: 'lst_1',
    asset: 'USDC',
    amount: '100',
    price: '5000',
    side: 'buy',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  quote: {
    id: 'quo_1',
    listingId: 'lst_1',
    asset: 'USDC',
    amount: '100',
    price: '5000',
    side: 'buy',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  escrow: {
    id: 'esc_1',
    quoteId: 'quo_1',
    status: 'pending',
    amount: '100',
    asset: 'USDC',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  milestones: [],
  testMode: true,
  session: {
    sessionId: 'sess_1',
    clientSecret: 'cs_sess_1.sig',
    expiresAt: '2099-01-01T00:00:00.000Z',
    mode: 'buy',
  },
  scope,
};

describe('checkout-storage serialization', () => {
  it('round-trips a snapshot', () => {
    const raw = serializeCheckoutSnapshot(snapshot);
    expect(parseCheckoutSnapshot(raw)).toEqual(snapshot);
  });

  it('returns null for corrupt input without throwing', () => {
    expect(parseCheckoutSnapshot('{not-json')).toBeNull();
    expect(parseCheckoutSnapshot(JSON.stringify({ version: 99 }))).toBeNull();
    expect(parseCheckoutSnapshot(JSON.stringify({ version: 1, step: 'loading' }))).toBeNull();
  });

  it('detects quote and session expiry boundaries', () => {
    const now = Date.parse('2024-01-02T00:00:00.000Z');
    expect(
      isCheckoutSnapshotExpired(
        {
          ...snapshot,
          quote: { ...snapshot.quote!, expiresAt: '2024-01-02T00:00:00.000Z' },
        },
        now,
      ),
    ).toBe(true);

    expect(
      isCheckoutSnapshotExpired(
        {
          ...snapshot,
          session: { ...snapshot.session, expiresAt: '2024-01-01T23:59:59.000Z' },
        },
        now,
      ),
    ).toBe(true);
  });

  it('builds deterministic storage keys from scope', () => {
    expect(checkoutStorageKey(scope)).toBe('pacto:checkout:pk_test_123:lst_1:buy');
    expect(
      checkoutStorageKey(
        buildCheckoutSnapshotScope({ publishableKey: 'pk_test_123', mode: 'sell' }),
      ),
    ).toBe('pacto:checkout:pk_test_123:browse:sell');
  });

  it('matches scope for listing and browse modes', () => {
    expect(snapshotMatchesScope(snapshot, scope)).toBe(true);
    expect(
      snapshotMatchesScope(snapshot, {
        ...scope,
        publishableKey: 'pk_live_123',
      }),
    ).toBe(false);
  });
});

describe('checkout-storage adapters', () => {
  it('persists through memory storage', () => {
    const storage = createMemoryCheckoutStorage();
    const key = checkoutStorageKey(scope);
    const raw = serializeCheckoutSnapshot(snapshot);

    storage.setItem(key, raw);
    expect(storage.getItem(key)).toBe(raw);
    storage.removeItem(key);
    expect(storage.getItem(key)).toBeNull();
  });

  it('swallows web storage failures', () => {
    const storage = createWebCheckoutStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });

    expect(storage.getItem('key')).toBeNull();
    expect(() => storage.setItem('key', 'value')).not.toThrow();
    expect(() => storage.removeItem('key')).not.toThrow();
  });
});

describe('connect-core storage isolation', () => {
  it('does not reference platform storage APIs in source files', () => {
    const srcDir = join(import.meta.dirname);
    const forbidden = ['localStorage', 'sessionStorage', 'AsyncStorage'];
    const files = readdirSync(srcDir).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );

    for (const file of files) {
      const contents = readFileSync(join(srcDir, file), 'utf8');
      for (const identifier of forbidden) {
        expect(contents.includes(identifier), `${file} must not reference ${identifier}`).toBe(
          false,
        );
      }
    }
  });
});
