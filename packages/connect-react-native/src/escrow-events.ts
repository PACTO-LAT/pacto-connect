import {
  type CheckoutMode,
  type EscrowEvent,
  type EscrowStatus,
  Pacto,
  type PactoSession,
  type PactoSessionData,
} from '@pacto-connect/core';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export type PactoEscrowTransport = 'sse' | 'polling';

export interface UsePactoEscrowEventsOptions {
  gatewayUrl?: string;
  publishableKey: string;
  sessionId: string;
  clientSecret: string;
  expiresAt: string | Date;
  mode: CheckoutMode;
  escrowId: string;
  enabled?: boolean;
  /** Force a transport instead of auto-detecting streaming `fetch` support. */
  transport?: PactoEscrowTransport;
  /** Polling interval used when the SSE transport isn't available. Default 4000ms. */
  pollIntervalMs?: number;
  /**
   * How close to `expiresAt` counts as "expiring soon" and triggers a
   * `PactoSession.refresh()` before the next poll/reconnect. Default 30000ms.
   */
  sessionRefreshMarginMs?: number;
  onEvent?: (event: EscrowEvent) => void;
  /**
   * Called after the hook transparently rotates to a refreshed session
   * (new `clientSecret`/`expiresAt`) — persist it if you resume tracking
   * across app restarts.
   */
  onSessionRefresh?: (session: PactoSessionData) => void;
}

export interface UsePactoEscrowEventsResult {
  milestones: EscrowEvent[];
  /** Only populated by the polling transport — SSE tracks milestones, not a standalone status. */
  status: EscrowStatus | null;
  transport: PactoEscrowTransport | null;
  error: Error | null;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;
export const DEFAULT_SESSION_REFRESH_MARGIN_MS = 30_000;

/**
 * React Native's JS engine (Hermes/JSC) doesn't reliably expose a streaming
 * `fetch` response body — `ReadableStream` is typically undefined unless the
 * app installs a polyfill — so `connect-core`'s SSE-based
 * `EscrowEventSubscriber` (which calls `response.body.getReader()`) can't be
 * trusted to work out of the box. We feature-detect and fall back to polling
 * `escrows.getStatus()` on an interval, synthesizing milestone events from
 * status transitions. That fallback can't reconstruct the `fiat.reported`
 * milestone — there's no `EscrowStatus` value for it to poll — which is a
 * known, documented gap of the polling path, not a bug.
 */
export function resolvePactoEscrowTransport(forced?: PactoEscrowTransport): PactoEscrowTransport {
  if (forced) {
    return forced;
  }
  return typeof ReadableStream !== 'undefined' ? 'sse' : 'polling';
}

/** Pure check the refresh logic uses — exported for testing without a live clock. */
export function isSessionExpiringSoon(
  expiresAt: Date,
  marginMs: number = DEFAULT_SESSION_REFRESH_MARGIN_MS,
  now: number = Date.now(),
): boolean {
  return expiresAt.getTime() - now <= marginMs;
}

const STATUS_MILESTONE: Partial<
  Record<EscrowStatus, { type: EscrowEvent['type']; milestone: EscrowEvent['milestone'] }>
> = {
  funded: { type: 'escrow.funded', milestone: 'funded' },
  released: { type: 'released', milestone: 'released' },
  disputed: { type: 'disputed', milestone: 'disputed' },
};

/** Pure mapper the polling loop uses — exported for testing without a live timer. */
export function statusToSyntheticEvent(
  escrowId: string,
  previousStatus: EscrowStatus | null,
  status: EscrowStatus,
  updatedAt: string,
): EscrowEvent | null {
  if (status === previousStatus) {
    return null;
  }

  const mapped = STATUS_MILESTONE[status];
  if (!mapped) {
    return null;
  }

  return {
    cursor: `poll-${escrowId}-${status}-${updatedAt}`,
    type: mapped.type,
    escrowId,
    milestone: mapped.milestone,
    occurredAt: updatedAt,
  };
}

export function usePactoEscrowEvents(
  options: UsePactoEscrowEventsOptions,
): UsePactoEscrowEventsResult {
  const [milestones, setMilestones] = useState<EscrowEvent[]>([]);
  const [status, setStatus] = useState<EscrowStatus | null>(null);
  const [transport, setTransport] = useState<PactoEscrowTransport | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const onEventRef = useRef(options.onEvent);
  const onSessionRefreshRef = useRef(options.onSessionRefresh);

  useEffect(() => {
    onEventRef.current = options.onEvent;
    onSessionRefreshRef.current = options.onSessionRefresh;
  });

  useEffect(() => {
    if (options.enabled === false) {
      return;
    }

    const resolvedTransport = resolvePactoEscrowTransport(options.transport);
    setTransport(resolvedTransport);
    setMilestones([]);
    setStatus(null);
    setError(null);

    const client = Pacto.init({
      publishableKey: options.publishableKey,
      gatewayUrl: options.gatewayUrl,
    });

    let currentSession: PactoSession = client.resumeCheckoutSession({
      sessionId: options.sessionId,
      clientSecret: options.clientSecret,
      expiresAt:
        options.expiresAt instanceof Date ? options.expiresAt : new Date(options.expiresAt),
      mode: options.mode,
    });

    let cancelled = false;
    let previousStatus: EscrowStatus | null = null;
    const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const refreshMarginMs = options.sessionRefreshMarginMs ?? DEFAULT_SESSION_REFRESH_MARGIN_MS;

    function record(event: EscrowEvent): void {
      setMilestones((prev) => [...prev, event]);
      onEventRef.current?.(event);
    }

    // Mobile sessions can sit open (or backgrounded) far longer than a web
    // checkout tab — long enough to outlive the session's `expiresAt`. Roll
    // to a fresh session transparently before that happens, rather than
    // letting every subsequent request start failing with 401s.
    async function ensureFreshSession(): Promise<PactoSession> {
      if (!isSessionExpiringSoon(currentSession.expiresAt, refreshMarginMs)) {
        return currentSession;
      }

      try {
        const refreshed = await currentSession.refresh();
        currentSession = refreshed;
        onSessionRefreshRef.current?.({
          sessionId: refreshed.sessionId,
          clientSecret: refreshed.clientSecret,
          expiresAt: refreshed.expiresAt,
          mode: refreshed.mode,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }

      return currentSession;
    }

    async function pollOnce(): Promise<void> {
      if (cancelled) {
        return;
      }

      const session = await ensureFreshSession();
      if (cancelled) {
        return;
      }

      try {
        const api = client.api(session);
        const { status: statusResponse } = await api.escrows.getStatus(options.escrowId);
        if (cancelled) {
          return;
        }

        setStatus(statusResponse.status);
        const event = statusToSyntheticEvent(
          options.escrowId,
          previousStatus,
          statusResponse.status,
          statusResponse.updatedAt,
        );
        previousStatus = statusResponse.status;
        if (event) {
          record(event);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    function subscribeSse(): void {
      const handler = (event: EscrowEvent) => record(event);
      for (const name of ['escrow.funded', 'fiat.reported', 'released', 'disputed'] as const) {
        currentSession.on(name, handler, { escrowId: options.escrowId });
      }
    }

    // A backgrounded RN app has its JS runtime suspended on iOS (and often
    // throttled on Android), so a live SSE connection or the poll interval
    // both go stale while the app is away — neither reliably resumes or
    // errors out on its own. Force a fresh connection whenever the app
    // returns to the foreground instead of waiting to notice it's stuck.
    async function reconnectOnForeground(): Promise<void> {
      if (cancelled) {
        return;
      }

      if (resolvedTransport === 'sse') {
        currentSession.closeEvents();
        const session = await ensureFreshSession();
        if (cancelled) {
          return;
        }
        void session;
        subscribeSse();
        return;
      }

      await pollOnce();
    }

    let pollTimer: ReturnType<typeof setInterval> | undefined;

    if (resolvedTransport === 'sse') {
      subscribeSse();
    } else {
      void pollOnce();
      pollTimer = setInterval(() => void pollOnce(), intervalMs);
    }

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void reconnectOnForeground();
      }
    });

    return () => {
      cancelled = true;
      appStateSubscription.remove();
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      currentSession.closeEvents();
    };
  }, [
    options.enabled,
    options.gatewayUrl,
    options.publishableKey,
    options.sessionId,
    options.clientSecret,
    options.expiresAt,
    options.mode,
    options.escrowId,
    options.transport,
    options.pollIntervalMs,
    options.sessionRefreshMarginMs,
  ]);

  return { milestones, status, transport, error };
}
