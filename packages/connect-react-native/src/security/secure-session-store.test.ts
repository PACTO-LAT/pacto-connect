import type { CheckoutSnapshotScope } from '@pacto-connect/core';
import { describe, expect, it } from 'vitest';
import {
  createMemorySecureSessionStore,
  createMemorySecureStorageBackend,
  createSecureSessionStore,
} from './secure-session-store.js';

const scope: CheckoutSnapshotScope = {
  publishableKey: 'pk_test_abc',
  listingId: 'lst_1',
  browse: false,
  mode: 'buy',
};

const session = {
  sessionId: 'sess_1',
  clientSecret: 'cs_test_secret',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  mode: 'buy' as const,
};

describe('secure session store', () => {
  it('threat_storage_exfil_session_in_keychain_adapter persists session material via adapter', async () => {
    const backend = createMemorySecureStorageBackend();
    const store = createSecureSessionStore(backend);
    await store.saveSession(scope, session);

    const loaded = await store.loadSession(scope);
    expect(loaded).toEqual(session);

    const raw = await backend.getItem('pacto-connect:session:pacto:checkout:pk_test_abc:lst_1:buy');
    expect(raw).toContain('cs_test_secret');
  });

  it('returns null for missing or corrupt session data', async () => {
    const store = createMemorySecureSessionStore();
    expect(await store.loadSession(scope)).toBeNull();

    const backend = createMemorySecureStorageBackend();
    await backend.setItem('pacto-connect:session:pacto:checkout:pk_test_abc:lst_1:buy', 'not-json');
    const corruptStore = createSecureSessionStore(backend);
    expect(await corruptStore.loadSession(scope)).toBeNull();
  });

  it('clears session material for a scope', async () => {
    const store = createMemorySecureSessionStore();
    await store.saveSession(scope, session);
    await store.clearSession(scope);
    expect(await store.loadSession(scope)).toBeNull();
  });
});
