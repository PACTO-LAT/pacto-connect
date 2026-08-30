import type { CheckoutMode, CheckoutSnapshotScope } from '@pacto-connect/core';
import { PactoSecurityError } from '@pacto-connect/core';

export interface LinkStateRecord {
  state: string;
  scope: CheckoutSnapshotScope;
  sessionId?: string;
  issuedAt: number;
  consumed: boolean;
}

export interface LinkStateStore {
  issue(scope: CheckoutSnapshotScope, sessionId?: string): Promise<string>;
  verify(state: string, scope: CheckoutSnapshotScope, sessionId?: string): Promise<void>;
  consume(state: string): Promise<void>;
}

export const DEFAULT_LINK_STATE_TTL_MS = 60 * 60 * 1000;

function generateStateToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

function scopeMatches(
  record: LinkStateRecord,
  scope: CheckoutSnapshotScope,
  sessionId?: string,
): boolean {
  if (record.scope.publishableKey !== scope.publishableKey) {
    return false;
  }
  if (record.scope.mode !== scope.mode) {
    return false;
  }
  if ((record.scope.listingId ?? undefined) !== (scope.listingId ?? undefined)) {
    return false;
  }
  if (sessionId && record.sessionId && record.sessionId !== sessionId) {
    return false;
  }
  return true;
}

export function createLinkStateStore(options?: {
  ttlMs?: number;
  now?: () => number;
  storage?: Map<string, LinkStateRecord>;
}): LinkStateStore {
  const ttlMs = options?.ttlMs ?? DEFAULT_LINK_STATE_TTL_MS;
  const now = options?.now ?? (() => Date.now());
  const records = options?.storage ?? new Map<string, LinkStateRecord>();

  return {
    async issue(scope, sessionId) {
      const state = generateStateToken();
      records.set(state, {
        state,
        scope,
        sessionId,
        issuedAt: now(),
        consumed: false,
      });
      return state;
    },
    async verify(state, scope, sessionId) {
      if (!state || typeof state !== 'string') {
        throw new PactoSecurityError('link_state_malformed', 'Return link state is malformed');
      }

      const record = records.get(state);
      if (!record) {
        throw new PactoSecurityError(
          'link_state_invalid',
          'Return link state is not bound to an active checkout',
        );
      }

      if (record.consumed) {
        throw new PactoSecurityError(
          'link_state_replayed',
          'Return link state has already been used',
        );
      }

      if (now() - record.issuedAt > ttlMs) {
        records.delete(state);
        throw new PactoSecurityError('link_state_invalid', 'Return link state has expired');
      }

      if (!scopeMatches(record, scope, sessionId)) {
        throw new PactoSecurityError(
          'link_state_invalid',
          'Return link state is not bound to this checkout',
        );
      }
    },
    async consume(state) {
      const record = records.get(state);
      if (record) {
        record.consumed = true;
      }
    },
  };
}

export function appendLinkState(returnUrl: string, state: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

export type LinkStateFailureReason =
  | 'link_state_missing'
  | 'link_state_malformed'
  | 'link_state_invalid'
  | 'link_state_replayed';

export function extractLinkStateFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('state');
  } catch {
    return null;
  }
}

export function linkStateFailureReason(error: unknown): LinkStateFailureReason | null {
  if (error instanceof PactoSecurityError) {
    const code = error.detailCode;
    if (
      code === 'link_state_missing' ||
      code === 'link_state_malformed' ||
      code === 'link_state_invalid' ||
      code === 'link_state_replayed'
    ) {
      return code;
    }
  }
  return null;
}

export type { CheckoutMode };
