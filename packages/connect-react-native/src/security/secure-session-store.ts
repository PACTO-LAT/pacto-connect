import type { CheckoutSessionEnvelope, CheckoutSnapshotScope } from '@pacto-connect/core';
import { checkoutStorageKey } from '@pacto-connect/core';
import { createKeychainSecureStorageBackend } from './keychain-backend.js';

export interface SecureStorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SecureSessionStoreAdapter {
  saveSession(scope: CheckoutSnapshotScope, session: CheckoutSessionEnvelope): Promise<void>;
  loadSession(scope: CheckoutSnapshotScope): Promise<CheckoutSessionEnvelope | null>;
  clearSession(scope: CheckoutSnapshotScope): Promise<void>;
  clearAll(): Promise<void>;
}

const SESSION_NAMESPACE = 'pacto-connect:session:';

function sessionKey(scope: CheckoutSnapshotScope): string {
  return `${SESSION_NAMESPACE}${checkoutStorageKey(scope)}`;
}

export function createSecureSessionStore(backend: SecureStorageBackend): SecureSessionStoreAdapter {
  return {
    async saveSession(scope, session) {
      await backend.setItem(sessionKey(scope), JSON.stringify(session));
    },
    async loadSession(scope) {
      const raw = await backend.getItem(sessionKey(scope));
      if (!raw) {
        return null;
      }

      try {
        const parsed = JSON.parse(raw) as CheckoutSessionEnvelope;
        if (
          typeof parsed.sessionId !== 'string' ||
          typeof parsed.clientSecret !== 'string' ||
          typeof parsed.expiresAt !== 'string' ||
          (parsed.mode !== 'buy' && parsed.mode !== 'sell')
        ) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    async clearSession(scope) {
      await backend.removeItem(sessionKey(scope));
    },
    async clearAll() {
      // Backends without enumeration rely on explicit clearSession calls.
    },
  };
}

/** In-memory backend for tests and environments without native secure storage. */
export function createMemorySecureStorageBackend(): SecureStorageBackend {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return Promise.resolve(store.get(key) ?? null);
    },
    setItem(key, value) {
      store.set(key, value);
      return Promise.resolve();
    },
    removeItem(key) {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

export function createMemorySecureSessionStore(): SecureSessionStoreAdapter {
  return createSecureSessionStore(createMemorySecureStorageBackend());
}

export function createDefaultSecureSessionStore(): SecureSessionStoreAdapter {
  return createSecureSessionStore(createKeychainSecureStorageBackend());
}
