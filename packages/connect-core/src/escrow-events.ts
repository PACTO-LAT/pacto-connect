import {
  PactoCircuitOpenError,
  PactoError,
  PactoRetryExhaustedError,
  PactoTimeoutError,
} from './errors.js';
import { type FetchLike, PUBLISHABLE_KEY_HEADER } from './http.js';
import { ResiliencePolicy, type ResiliencePolicyConfig, withTimeout } from './resilience/index.js';
import { readSseStream, type SseMessage } from './sse.js';

export const ESCROW_EVENT_NAMES = [
  'escrow.funded',
  'fiat.reported',
  'released',
  'disputed',
  'cancelled',
  'refunded',
  'dispute.resolved',
] as const;

export type EscrowEventName = (typeof ESCROW_EVENT_NAMES)[number];

/** Maps to Pacto P2P `escrow_milestones` lifecycle states. */
export type EscrowMilestone =
  | 'funded'
  | 'fiat_reported'
  | 'released'
  | 'disputed'
  | 'cancelled'
  | 'refunded'
  | 'dispute_resolved';

export interface EscrowEvent {
  cursor: string;
  type: EscrowEventName;
  escrowId: string;
  milestone: EscrowMilestone;
  occurredAt: string;
  data?: Record<string, unknown>;
}

export type EscrowEventHandler = (event: EscrowEvent) => void;

export interface EscrowSubscribeOptions {
  escrowId?: string;
}

export interface SessionConnectionConfig {
  gatewayUrl: string;
  publishableKey: string;
  clientSecret: string;
  origin?: string;
  baseDelayMs?: number;
  /**
   * Local ceiling on consecutive connection failures for this subscriber
   * before it gives up and surfaces a {@link PactoRetryExhaustedError} via
   * `onError`. Independent of (and in addition to) the shared session-wide
   * retry budget on `resiliencePolicy`.
   */
  maxReconnectAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  fetch?: FetchLike;
  /**
   * Shared resilience policy (timeout, session-wide retry budget, backoff,
   * circuit breaker). When omitted, a policy scoped to just this subscriber
   * is built from `baseDelayMs`/`maxReconnectAttempts`/`sleep`.
   */
  resiliencePolicy?: ResiliencePolicy;
  /**
   * Called when the subscriber gives up reconnecting (retry budget/ceiling
   * exhausted), hits a non-retryable failure, or the circuit breaker rejects
   * a connection attempt. Without this, those conditions previously failed
   * silently — the stream just stopped.
   */
  onError?: (error: PactoError) => void;
}

const MILESTONE_BY_EVENT: Record<EscrowEventName, EscrowMilestone> = {
  'escrow.funded': 'funded',
  'fiat.reported': 'fiat_reported',
  released: 'released',
  disputed: 'disputed',
  cancelled: 'cancelled',
  refunded: 'refunded',
  'dispute.resolved': 'dispute_resolved',
};

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

function isEscrowEventName(value: string): value is EscrowEventName {
  return (ESCROW_EVENT_NAMES as readonly string[]).includes(value);
}

/** Normalizes an arbitrary thrown value into a `PactoError` for `onError`. */
function toPactoError(err: unknown): PactoError {
  if (err instanceof PactoError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new PactoError('connection_error', 'PACTO_NETWORK', 'connection_failed', message);
}

/** Builds a subscriber-scoped policy when the caller doesn't share one across a session. */
export function resolveEscrowResiliencePolicy(config: SessionConnectionConfig): ResiliencePolicy {
  if (config.resiliencePolicy) {
    return config.resiliencePolicy;
  }

  const policyConfig: ResiliencePolicyConfig = {
    baseDelayMs: config.baseDelayMs,
    sleep: config.sleep,
    retryBudget: config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
  };

  return new ResiliencePolicy(policyConfig);
}

function mapToEscrowEvent(
  cursor: string | undefined,
  type: EscrowEventName,
  payload: Record<string, unknown>,
): EscrowEvent | null {
  const escrowId = typeof payload.escrowId === 'string' ? payload.escrowId : undefined;
  const occurredAt =
    typeof payload.occurredAt === 'string'
      ? payload.occurredAt
      : typeof payload.timestamp === 'string'
        ? payload.timestamp
        : undefined;

  if (!escrowId || !occurredAt || !cursor) {
    return null;
  }

  return {
    cursor,
    type,
    escrowId,
    milestone: MILESTONE_BY_EVENT[type],
    occurredAt,
    ...(Object.keys(payload).length > 0
      ? {
          data: Object.fromEntries(
            Object.entries(payload).filter(
              ([key]) =>
                key !== 'escrowId' &&
                key !== 'occurredAt' &&
                key !== 'milestone' &&
                key !== 'timestamp',
            ),
          ),
        }
      : {}),
  };
}

type HandlerEntry = {
  handler: EscrowEventHandler;
  escrowId?: string;
};

export class EscrowEventSubscriber {
  private readonly handlers = new Map<EscrowEventName, Set<HandlerEntry>>();
  private lastCursor?: string;
  private closed = false;
  private connecting = false;
  /** Consecutive connection failures for this subscriber (resets on a successful/clean connection). */
  private localFailures = 0;
  private readonly seenCursors = new Set<string>();
  private readonly filterEscrowId?: string;
  private readonly policy: ResiliencePolicy;
  private readonly localFailureCeiling: number;

  constructor(
    private readonly config: SessionConnectionConfig,
    options?: EscrowSubscribeOptions,
  ) {
    this.filterEscrowId = options?.escrowId;
    this.policy = resolveEscrowResiliencePolicy(config);
    this.localFailureCeiling = config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  }

  on(event: EscrowEventName, handler: EscrowEventHandler, options?: EscrowSubscribeOptions): void {
    const entries = this.handlers.get(event) ?? new Set<HandlerEntry>();
    entries.add({ handler, escrowId: options?.escrowId ?? this.filterEscrowId });
    this.handlers.set(event, entries);

    if (!this.closed && !this.connecting) {
      this.connectLoop();
    }
  }

  off(event: EscrowEventName, handler: EscrowEventHandler): void {
    const entries = this.handlers.get(event);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      if (entry.handler === handler) {
        entries.delete(entry);
      }
    }

    if (entries.size === 0) {
      this.handlers.delete(event);
    }
  }

  close(): void {
    this.closed = true;
    this.handlers.clear();
  }

  private hasHandlers(): boolean {
    return this.handlers.size > 0;
  }

  private async connectLoop(): Promise<void> {
    if (this.closed || !this.hasHandlers()) {
      return;
    }

    this.connecting = true;

    while (!this.closed && this.hasHandlers()) {
      if (this.policy.breaker && !this.policy.breaker.canRequest()) {
        this.emitError(
          new PactoCircuitOpenError(
            'circuit_open',
            'Escrow event stream circuit is open; reconnect deferred',
            this.policy.breaker.msUntilHalfOpen(),
          ),
        );
        await this.sleep()(this.policy.breaker.msUntilHalfOpen() || this.policy.computeDelay(0));
        continue;
      }

      try {
        await this.connectOnce();
        this.policy.breaker?.onSuccess();
        this.localFailures = 0;
        // A clean stream close (server ended the connection normally) is not
        // a failure — reconnect immediately without consuming backoff/budget.
        continue;
      } catch (err) {
        this.policy.breaker?.onFailure();

        if (this.closed || !this.hasHandlers()) {
          break;
        }

        if (!this.policy.isRetryable(err)) {
          this.emitError(toPactoError(err));
          break;
        }

        this.localFailures += 1;
        if (this.localFailures > this.localFailureCeiling) {
          this.emitError(
            new PactoRetryExhaustedError(
              'reconnect_budget_exhausted',
              'Escrow event stream reconnect ceiling exhausted',
              this.localFailures,
            ),
          );
          break;
        }

        if (!this.policy.budget.tryConsume()) {
          this.emitError(
            new PactoRetryExhaustedError(
              'retry_budget_exhausted',
              'Session-wide retry budget exhausted while reconnecting the escrow event stream',
              this.localFailures,
            ),
          );
          break;
        }

        const delay = this.policy.computeDelay(this.localFailures - 1);
        await this.sleep()(delay);
      }
    }

    this.connecting = false;
  }

  private emitError(error: PactoError): void {
    this.config.onError?.(error);
  }

  private async connectOnce(): Promise<void> {
    const url = new URL(`${this.config.gatewayUrl}/v1/escrows/events`);
    if (this.filterEscrowId) {
      url.searchParams.set('escrowId', this.filterEscrowId);
    }
    if (this.lastCursor) {
      url.searchParams.set('cursor', this.lastCursor);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.clientSecret}`,
      [PUBLISHABLE_KEY_HEADER]: this.config.publishableKey,
      Accept: 'text/event-stream',
    };

    if (this.config.origin) {
      headers.Origin = this.config.origin;
    }

    const fetchFn = this.config.fetch ?? fetch;

    // Only the initial connect is bounded by the per-attempt timeout — once
    // the stream is open, `readSseStream`'s idle timeout takes over so a
    // healthy, long-lived stream is never cut off by it.
    const response = await withTimeout(
      (signal) => fetchFn(url.toString(), { method: 'GET', headers, signal }),
      this.policy.timeoutMs,
      () => new PactoTimeoutError('connect_timeout', 'Escrow event stream connection timed out'),
    );

    if (!response.ok || !response.body) {
      throw new Error(`Escrow event stream failed with status ${response.status}`);
    }

    await readSseStream(response.body, (message) => this.handleMessage(message), {
      idleTimeoutMs: this.policy.streamIdleTimeoutMs,
    });
  }

  private handleMessage(message: SseMessage): void {
    if (message.id) {
      if (this.seenCursors.has(message.id)) {
        return;
      }
      this.seenCursors.add(message.id);
      this.lastCursor = message.id;
    }

    if (!message.event || !message.data) {
      return;
    }

    if (!isEscrowEventName(message.event)) {
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(message.data) as Record<string, unknown>;
    } catch {
      return;
    }

    const escrowEvent = mapToEscrowEvent(message.id, message.event, payload);
    if (!escrowEvent) {
      return;
    }

    const entries = this.handlers.get(message.event);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      if (entry.escrowId && entry.escrowId !== escrowEvent.escrowId) {
        continue;
      }
      entry.handler(escrowEvent);
    }
  }

  private sleep(): (ms: number) => Promise<void> {
    return (ms) => this.policy.sleep(ms);
  }
}
