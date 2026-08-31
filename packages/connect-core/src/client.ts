/**
 * Pacto client bootstrap — extracted from index for use by checkout-flow without circular imports.
 */

import type { CheckoutMode, GatewaySessionResponse } from './api-types.js';
import { errorFromResponse, type GatewayErrorBody, PactoError } from './errors.js';
import {
  type EscrowEventHandler,
  type EscrowEventName,
  EscrowEventSubscriber,
  type EscrowSubscribeOptions,
} from './escrow-events.js';
import { type FetchLike, PUBLISHABLE_KEY_HEADER } from './http.js';
import {
  type CircuitBreakerConfig,
  type CircuitBreakerTransition,
  ResiliencePolicy,
  type ResiliencePolicyConfig,
} from './resilience/index.js';
import { createApiClient, type PactoApiClient } from './resources.js';

export type { CheckoutMode } from './api-types.js';

export interface PactoInitOptions {
  /** Publishable key issued by the Connect Gateway (pk_live_* / pk_test_*). */
  publishableKey: string;
  /** Gateway base URL. Defaults to the hosted Pacto Connect gateway. */
  gatewayUrl?: string;
  /** Origin header for non-browser environments. */
  origin?: string;
  /** Maximum retry attempts for a single request, on top of its first attempt. Default 3. */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff. Default 250. */
  baseDelayMs?: number;
  /** Backoff delay ceiling, in milliseconds. Default 8000. */
  maxDelayMs?: number;
  /**
   * Total retry attempts permitted across every request and stream
   * reconnect made by this client (a "session-wide" budget) — bounds the
   * traffic a single degraded gateway sees from this client, regardless of
   * how many individual calls are in flight. Default 50.
   */
  retryBudget?: number;
  /** Per-attempt timeout in milliseconds, applied to HTTP requests and opening an event stream. Default 10000. */
  timeoutMs?: number;
  /** Idle-read timeout for the escrow event stream, in milliseconds. Default 45000. */
  streamIdleTimeoutMs?: number;
  /** Circuit breaker configuration. Pass `false` to disable it entirely. */
  breaker?: Partial<CircuitBreakerConfig> | false;
  /** Observe circuit breaker state transitions (open/half-open/closed) for logging or metrics. */
  onBreakerStateChange?: (transition: CircuitBreakerTransition) => void;
  /** Maximum reconnect attempts for escrow event streams. Default 5. */
  maxReconnectAttempts?: number;
  /** Custom fetch implementation (e.g. certificate-pinned fetch in React Native). */
  fetch?: FetchLike;
}

export type CreateCheckoutSessionParams =
  | { listingId: string; mode: CheckoutMode }
  | { quote: Record<string, unknown>; mode: CheckoutMode };

export interface PactoSessionData {
  sessionId: string;
  clientSecret: string;
  expiresAt: Date;
  mode: CheckoutMode;
}

export interface PactoClient {
  readonly publishableKey: string;
  readonly gatewayUrl: string;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<PactoSession>;
  resumeCheckoutSession(data: PactoSessionData): PactoSession;
  api(session: PactoSession): PactoApiClient;
}

interface SessionRuntimeConfig {
  gatewayUrl: string;
  publishableKey: string;
  origin?: string;
  baseDelayMs?: number;
  maxRetries?: number;
  maxReconnectAttempts?: number;
  fetch?: FetchLike;
  /**
   * Shared across every request and stream this client makes, so the retry
   * budget and circuit breaker are scoped to the client's lifetime rather
   * than to any single call — see `resilience/policy.ts`.
   */
  resiliencePolicy: ResiliencePolicy;
}

export const DEFAULT_GATEWAY_URL = 'https://connect.pacto.example';

function isCheckoutMode(value: string): value is CheckoutMode {
  return value === 'buy' || value === 'sell';
}

export class PactoSession {
  readonly sessionId: string;
  readonly clientSecret: string;
  readonly expiresAt: Date;
  readonly mode: CheckoutMode;

  private subscriber?: EscrowEventSubscriber;
  private streamErrorHandlers = new Set<(error: PactoError) => void>();

  constructor(
    private readonly client: InternalPactoClient,
    data: PactoSessionData,
  ) {
    this.sessionId = data.sessionId;
    this.clientSecret = data.clientSecret;
    this.expiresAt = data.expiresAt;
    this.mode = data.mode;
  }

  isExpired(): boolean {
    return this.expiresAt.getTime() <= Date.now();
  }

  async refresh(): Promise<PactoSession> {
    const data = await this.client.refreshSession(this.clientSecret);
    return new PactoSession(this.client, data);
  }

  on(event: EscrowEventName, handler: EscrowEventHandler, options?: EscrowSubscribeOptions): void {
    this.subscriber ??= this.createSubscriber();
    this.subscriber.on(event, handler, options);
  }

  off(event: EscrowEventName, handler: EscrowEventHandler): void {
    this.subscriber?.off(event, handler);
  }

  /**
   * Observes escrow event stream failures that the subscriber gave up on —
   * a non-retryable error, an exhausted retry budget/ceiling, or the
   * circuit breaker rejecting a reconnect. Returns an unsubscribe function.
   */
  onStreamError(handler: (error: PactoError) => void): () => void {
    this.streamErrorHandlers.add(handler);
    this.subscriber ??= this.createSubscriber();
    return () => {
      this.streamErrorHandlers.delete(handler);
    };
  }

  closeEvents(): void {
    this.subscriber?.close();
    this.subscriber = undefined;
  }

  private createSubscriber(): EscrowEventSubscriber {
    return new EscrowEventSubscriber({
      gatewayUrl: this.client.runtime.gatewayUrl,
      publishableKey: this.client.runtime.publishableKey,
      clientSecret: this.clientSecret,
      origin: this.client.runtime.origin,
      baseDelayMs: this.client.runtime.baseDelayMs,
      maxReconnectAttempts: this.client.runtime.maxReconnectAttempts,
      fetch: this.client.runtime.fetch,
      resiliencePolicy: this.client.runtime.resiliencePolicy,
      onError: (error) => {
        for (const handler of this.streamErrorHandlers) {
          handler(error);
        }
      },
    });
  }
}

interface InternalPactoClient extends PactoClient {
  readonly runtime: SessionRuntimeConfig;
  refreshSession(clientSecret: string): Promise<PactoSessionData>;
}

function buildResiliencePolicy(options: PactoInitOptions): ResiliencePolicy {
  const config: ResiliencePolicyConfig = {
    timeoutMs: options.timeoutMs,
    streamIdleTimeoutMs: options.streamIdleTimeoutMs,
    maxRetries: options.maxRetries,
    retryBudget: options.retryBudget,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    breaker: options.breaker,
    onBreakerStateChange: options.onBreakerStateChange,
  };

  return new ResiliencePolicy(config);
}

function createGatewayClient(options: PactoInitOptions): InternalPactoClient {
  const publishableKey = options.publishableKey;
  const gatewayUrl = options.gatewayUrl ?? DEFAULT_GATEWAY_URL;
  const origin = options.origin;
  const maxRetries = options.maxRetries;
  const baseDelayMs = options.baseDelayMs;
  const maxReconnectAttempts = options.maxReconnectAttempts;
  const fetchFn = options.fetch;
  const resiliencePolicy = buildResiliencePolicy(options);

  const runtime: SessionRuntimeConfig = {
    gatewayUrl,
    publishableKey,
    origin,
    baseDelayMs,
    maxRetries,
    maxReconnectAttempts,
    fetch: fetchFn,
    resiliencePolicy,
  };

  async function requestSession(
    path: string,
    body: Record<string, unknown>,
  ): Promise<PactoSessionData> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [PUBLISHABLE_KEY_HEADER]: publishableKey,
    };

    if (origin) {
      headers.Origin = origin;
    }

    const responseBody = await resiliencePolicy.execute<GatewaySessionResponse & GatewayErrorBody>(
      async ({ signal }) => {
        const response = await (fetchFn ?? fetch)(`${gatewayUrl}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        });

        const parsed = (await response.json()) as GatewaySessionResponse & GatewayErrorBody;

        if (!response.ok) {
          throw errorFromResponse(response.status, parsed, { path });
        }

        return parsed;
      },
    );

    if (
      !responseBody.sessionId ||
      !responseBody.clientSecret ||
      !responseBody.expiresAt ||
      !isCheckoutMode(responseBody.mode)
    ) {
      throw new PactoError(
        'gateway_error',
        'PACTO_UNKNOWN',
        'invalid_response',
        'Gateway returned an invalid session payload',
      );
    }

    return {
      sessionId: responseBody.sessionId,
      clientSecret: responseBody.clientSecret,
      expiresAt: new Date(responseBody.expiresAt),
      mode: responseBody.mode,
    };
  }

  return {
    publishableKey,
    gatewayUrl,
    runtime,
    async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<PactoSession> {
      const data = await requestSession('/v1/session', params);
      return new PactoSession(this, data);
    },
    resumeCheckoutSession(data: PactoSessionData): PactoSession {
      return new PactoSession(this, data);
    },
    async refreshSession(clientSecret: string): Promise<PactoSessionData> {
      return requestSession('/v1/session/refresh', { clientSecret });
    },
    api(session: PactoSession): PactoApiClient {
      return createApiClient({
        gatewayUrl,
        publishableKey,
        clientSecret: session.clientSecret,
        origin,
        maxRetries,
        baseDelayMs,
        fetch: fetchFn,
        resiliencePolicy,
      });
    },
  };
}

/** Entry point for the Pacto Connect SDK. */
export function init(options: PactoInitOptions): PactoClient {
  if (!options.publishableKey) {
    throw new Error('[pacto-connect] publishableKey is required');
  }

  return createGatewayClient(options);
}

export const Pacto = { init };
