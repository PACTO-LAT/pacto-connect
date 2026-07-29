import { type CheckoutMode, type EscrowEvent, type EscrowStatus, Pacto } from '@pacto-connect/core';
import { useEffect, useRef, useState } from 'react';

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
  onEvent?: (event: EscrowEvent) => void;
}

export interface UsePactoEscrowEventsResult {
  milestones: EscrowEvent[];
  /** Only populated by the polling transport — SSE tracks milestones, not a standalone status. */
  status: EscrowStatus | null;
  transport: PactoEscrowTransport | null;
  error: Error | null;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;

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

  useEffect(() => {
    onEventRef.current = options.onEvent;
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
    const session = client.resumeCheckoutSession({
      sessionId: options.sessionId,
      clientSecret: options.clientSecret,
      expiresAt:
        options.expiresAt instanceof Date ? options.expiresAt : new Date(options.expiresAt),
      mode: options.mode,
    });

    function record(event: EscrowEvent): void {
      setMilestones((prev) => [...prev, event]);
      onEventRef.current?.(event);
    }

    if (resolvedTransport === 'sse') {
      const handler = (event: EscrowEvent) => record(event);
      for (const name of ['escrow.funded', 'fiat.reported', 'released', 'disputed'] as const) {
        session.on(name, handler, { escrowId: options.escrowId });
      }

      return () => {
        session.closeEvents();
      };
    }

    let cancelled = false;
    let previousStatus: EscrowStatus | null = null;
    const api = client.api(session);
    const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    async function poll(): Promise<void> {
      try {
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

    void poll();
    const interval = setInterval(() => void poll(), intervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
      session.closeEvents();
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
  ]);

  return { milestones, status, transport, error };
}
