import type { CheckoutStep } from './checkout-machine.js';
import type { CheckoutMode } from './client.js';
import type { EscrowEvent } from './escrow-events.js';
import type { Escrow, Listing, Quote } from './resources.js';

export const CHECKOUT_SNAPSHOT_VERSION = 1 as const;

export interface CheckoutSessionEnvelope {
  sessionId: string;
  clientSecret: string;
  expiresAt: string;
  mode: CheckoutMode;
}

export interface CheckoutSnapshotScope {
  publishableKey: string;
  listingId?: string;
  browse: boolean;
  mode: CheckoutMode;
}

export interface CheckoutSnapshot {
  version: typeof CHECKOUT_SNAPSHOT_VERSION;
  step: CheckoutStep;
  sessionId: string;
  selectedListing: Listing | null;
  quote: Quote | null;
  escrow: Escrow | null;
  milestones: EscrowEvent[];
  testMode: boolean;
  session: CheckoutSessionEnvelope;
  scope: CheckoutSnapshotScope;
}

export interface CheckoutStorageAdapter {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export function checkoutStorageKey(scope: CheckoutSnapshotScope): string {
  const listingScope = scope.listingId ?? 'browse';
  return `pacto:checkout:${scope.publishableKey}:${listingScope}:${scope.mode}`;
}

export function buildCheckoutSnapshotScope(options: {
  publishableKey: string;
  listingId?: string;
  mode: CheckoutMode;
}): CheckoutSnapshotScope {
  return {
    publishableKey: options.publishableKey,
    listingId: options.listingId,
    browse: !options.listingId,
    mode: options.mode,
  };
}

export function serializeCheckoutSnapshot(snapshot: CheckoutSnapshot): string {
  return JSON.stringify(snapshot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCheckoutStep(value: unknown): value is CheckoutStep {
  return (
    value === 'selectListing' ||
    value === 'deposit' ||
    value === 'uploadReceipt' ||
    value === 'tracking' ||
    value === 'success' ||
    value === 'disputed' ||
    value === 'refunded'
  );
}

export function parseCheckoutSnapshot(raw: string): CheckoutSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    if (parsed.version !== CHECKOUT_SNAPSHOT_VERSION) {
      return null;
    }

    if (!isCheckoutStep(parsed.step)) {
      return null;
    }

    if (typeof parsed.sessionId !== 'string') {
      return null;
    }

    if (!isRecord(parsed.session)) {
      return null;
    }

    const session = parsed.session;
    if (
      typeof session.sessionId !== 'string' ||
      typeof session.clientSecret !== 'string' ||
      typeof session.expiresAt !== 'string' ||
      (session.mode !== 'buy' && session.mode !== 'sell')
    ) {
      return null;
    }

    if (!isRecord(parsed.scope)) {
      return null;
    }

    const scope = parsed.scope;
    if (
      typeof scope.publishableKey !== 'string' ||
      typeof scope.browse !== 'boolean' ||
      (scope.mode !== 'buy' && scope.mode !== 'sell')
    ) {
      return null;
    }

    if (scope.listingId !== undefined && typeof scope.listingId !== 'string') {
      return null;
    }

    if (typeof parsed.testMode !== 'boolean') {
      return null;
    }

    if (!Array.isArray(parsed.milestones)) {
      return null;
    }

    return {
      version: CHECKOUT_SNAPSHOT_VERSION,
      step: parsed.step,
      sessionId: parsed.sessionId,
      selectedListing: (parsed.selectedListing as Listing | null) ?? null,
      quote: (parsed.quote as Quote | null) ?? null,
      escrow: (parsed.escrow as Escrow | null) ?? null,
      milestones: parsed.milestones as EscrowEvent[],
      testMode: parsed.testMode,
      session: {
        sessionId: session.sessionId,
        clientSecret: session.clientSecret,
        expiresAt: session.expiresAt,
        mode: session.mode,
      },
      scope: {
        publishableKey: scope.publishableKey,
        listingId: typeof scope.listingId === 'string' ? scope.listingId : undefined,
        browse: scope.browse,
        mode: scope.mode,
      },
    };
  } catch {
    return null;
  }
}

export function isCheckoutSnapshotExpired(snapshot: CheckoutSnapshot, now: number): boolean {
  const sessionExpiresAt = Date.parse(snapshot.session.expiresAt);
  if (!Number.isNaN(sessionExpiresAt) && sessionExpiresAt <= now) {
    return true;
  }

  if (!snapshot.quote?.expiresAt) {
    return false;
  }

  const quoteExpiresAt = Date.parse(snapshot.quote.expiresAt);
  if (Number.isNaN(quoteExpiresAt)) {
    return true;
  }

  return quoteExpiresAt <= now;
}

export function snapshotMatchesScope(
  snapshot: CheckoutSnapshot,
  scope: CheckoutSnapshotScope,
): boolean {
  if (snapshot.scope.publishableKey !== scope.publishableKey) {
    return false;
  }

  if (snapshot.scope.mode !== scope.mode) {
    return false;
  }

  if (snapshot.scope.browse !== scope.browse) {
    return false;
  }

  if (scope.listingId) {
    return snapshot.scope.listingId === scope.listingId;
  }

  return snapshot.scope.browse;
}

export function createMemoryCheckoutStorage(): CheckoutStorageAdapter {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createWebCheckoutStorage(storage: WebStorageLike): CheckoutStorageAdapter {
  return {
    getItem(key: string) {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string) {
      try {
        storage.setItem(key, value);
      } catch {
        // Host storage may be unavailable (private mode, quota).
      }
    },
    removeItem(key: string) {
      try {
        storage.removeItem(key);
      } catch {
        // Ignore storage failures — resume degrades to a fresh checkout.
      }
    },
  };
}
