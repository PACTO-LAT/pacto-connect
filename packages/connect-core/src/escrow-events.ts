import { PUBLISHABLE_KEY_HEADER } from './http.js';
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
  maxReconnectAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
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

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEscrowEventName(value: string): value is EscrowEventName {
  return (ESCROW_EVENT_NAMES as readonly string[]).includes(value);
}

function getBackoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return exponential + jitter;
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
            Object.entries(payload).filter(([key]) => key !== 'escrowId' && key !== 'occurredAt' && key !== 'milestone' && key !== 'timestamp'),
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
  private reconnectAttempt = 0;
  private readonly seenCursors = new Set<string>();
  private readonly filterEscrowId?: string;

  constructor(
    private readonly config: SessionConnectionConfig,
    options?: EscrowSubscribeOptions,
  ) {
    this.filterEscrowId = options?.escrowId;
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
      try {
        await this.connectOnce();
        this.reconnectAttempt = 0;
      } catch {
        if (this.closed || !this.hasHandlers()) {
          break;
        }

        if (this.reconnectAttempt >= this.maxReconnectAttempts()) {
          break;
        }

        const delay = getBackoffDelay(this.reconnectAttempt, this.baseDelayMs());
        await this.sleep()(delay);
        this.reconnectAttempt += 1;
      }
    }

    this.connecting = false;
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

    const response = await fetch(url.toString(), { method: 'GET', headers });

    if (!response.ok || !response.body) {
      throw new Error(`Escrow event stream failed with status ${response.status}`);
    }

    await readSseStream(response.body, (message) => this.handleMessage(message));
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

  private baseDelayMs(): number {
    return this.config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  }

  private maxReconnectAttempts(): number {
    return this.config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  }

  private sleep(): (ms: number) => Promise<void> {
    return this.config.sleep ?? defaultSleep;
  }
}
