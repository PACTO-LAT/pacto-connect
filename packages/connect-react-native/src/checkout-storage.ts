import { type CheckoutStorageAdapter, createMemoryCheckoutStorage } from '@pacto-connect/core';

export interface ReactNativeStorageBackend {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export function createReactNativeCheckoutStorage(
  backend: ReactNativeStorageBackend,
  namespace = 'pacto-connect:checkout',
): CheckoutStorageAdapter {
  const prefix = `${namespace}:`;

  return {
    getItem(key: string) {
      try {
        const value = backend.getItem(`${prefix}${key}`);
        return value instanceof Promise ? value.then((item) => item ?? null) : (value ?? null);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string) {
      try {
        const result = backend.setItem(`${prefix}${key}`, value);
        if (result instanceof Promise) {
          return result.then(() => undefined);
        }
      } catch {
        // Ignore native storage failures.
      }
    },
    removeItem(key: string) {
      try {
        const result = backend.removeItem(`${prefix}${key}`);
        if (result instanceof Promise) {
          return result.then(() => undefined);
        }
      } catch {
        // Ignore native storage failures.
      }
    },
  };
}

export function createDefaultReactNativeCheckoutStorage(): CheckoutStorageAdapter {
  return createMemoryCheckoutStorage();
}

export {
  buildCheckoutSnapshotScope,
  checkoutStorageKey,
  isCheckoutSnapshotExpired,
  parseCheckoutSnapshot,
} from '@pacto-connect/core';
