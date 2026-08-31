import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PactoCircuitOpenError, PactoRetryExhaustedError } from './errors.js';
import { EscrowEventSubscriber } from './escrow-events.js';
import { ResiliencePolicy } from './resilience/index.js';

function encodeSse(block: string): Uint8Array {
  return new TextEncoder().encode(block);
}

describe('escrow event subscription', () => {
  const sleep = vi.fn(async () => {});
  const gatewayUrl = 'https://gateway.example';
  const publishableKey = 'pk_test_123';
  const clientSecret = 'cs_session_1.signature';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    sleep.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps lifecycle events to escrow milestones', async () => {
    const handler = vi.fn();
    const subscriber = new EscrowEventSubscriber({
      gatewayUrl,
      publishableKey,
      clientSecret,
      sleep,
    });

    subscriber.on('escrow.funded', handler);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encodeSse(
            'id: cursor-1\nevent: escrow.funded\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:00:00.000Z"}\n\n',
          ),
        );
        controller.enqueue(
          encodeSse(
            'id: cursor-2\nevent: fiat.reported\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:05:00.000Z"}\n\n',
          ),
        );
        controller.close();
      },
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    } as Response);

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    expect(handler).toHaveBeenCalledWith({
      cursor: 'cursor-1',
      type: 'escrow.funded',
      escrowId: 'esc_1',
      milestone: 'funded',
      occurredAt: '2024-01-01T00:00:00.000Z',
      data: {},
    });

    subscriber.close();
  });

  it('reconnects with cursor and replays missed events without duplicates', async () => {
    const handler = vi.fn();
    const subscriber = new EscrowEventSubscriber({
      gatewayUrl,
      publishableKey,
      clientSecret,
      sleep,
      maxReconnectAttempts: 2,
    });

    subscriber.on('released', handler);

    const firstStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encodeSse(
            'id: cursor-1\nevent: escrow.funded\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:00:00.000Z"}\n\n',
          ),
        );
        controller.close();
      },
    });

    const secondStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encodeSse(
            'id: cursor-2\nevent: fiat.reported\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:05:00.000Z"}\n\n',
          ),
        );
        controller.enqueue(
          encodeSse(
            'id: cursor-3\nevent: released\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
          ),
        );
        controller.close();
      },
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: firstStream,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: secondStream,
      } as Response);

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2));

    expect(handler).toHaveBeenCalledWith({
      cursor: 'cursor-3',
      type: 'released',
      escrowId: 'esc_1',
      milestone: 'released',
      occurredAt: '2024-01-01T00:10:00.000Z',
      data: {},
    });

    const reconnectUrl = vi
      .mocked(fetch)
      .mock.calls.find((call, index) => index > 0 && String(call[0]).includes('cursor=cursor-1'));
    expect(reconnectUrl).toBeDefined();

    subscriber.close();
  });

  it('filters events by escrow id', async () => {
    const handler = vi.fn();
    const subscriber = new EscrowEventSubscriber({
      gatewayUrl,
      publishableKey,
      clientSecret,
      sleep,
    });

    subscriber.on('disputed', handler, { escrowId: 'esc_target' });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encodeSse(
            'id: cursor-1\nevent: disputed\ndata: {"escrowId":"esc_other","occurredAt":"2024-01-01T00:00:00.000Z"}\n\n',
          ),
        );
        controller.enqueue(
          encodeSse(
            'id: cursor-2\nevent: disputed\ndata: {"escrowId":"esc_target","occurredAt":"2024-01-01T00:01:00.000Z"}\n\n',
          ),
        );
        controller.close();
      },
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    } as Response);

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ escrowId: 'esc_target', type: 'disputed' }),
    );

    subscriber.close();
  });

  it('surfaces a non-retryable connection failure via onError instead of retrying silently', async () => {
    const onError = vi.fn();
    vi.mocked(fetch).mockRejectedValue(new Error('unauthorized'));

    // A custom classifier stands in for a non-retryable PactoError a custom
    // `fetch` implementation might throw (e.g. an auth failure it detects
    // itself) — it should stop the loop immediately, with no retry.
    const policy = new ResiliencePolicy({ sleep, isRetryable: () => false });

    const subscriber = new EscrowEventSubscriber({
      gatewayUrl,
      publishableKey,
      clientSecret,
      sleep,
      resiliencePolicy: policy,
      onError,
    });

    subscriber.on('released', vi.fn());

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(sleep).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);

    subscriber.close();
  });

  it('surfaces reconnect-budget exhaustion via onError as a typed PactoRetryExhaustedError', async () => {
    const onError = vi.fn();
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));

    const subscriber = new EscrowEventSubscriber({
      gatewayUrl,
      publishableKey,
      clientSecret,
      sleep,
      maxReconnectAttempts: 2,
      onError,
    });

    subscriber.on('released', vi.fn());

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith(expect.any(PactoRetryExhaustedError));

    subscriber.close();
  });

  it('shares a circuit breaker via an injected resiliencePolicy and rejects fast while open', async () => {
    const onError = vi.fn();
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));

    // Deliberately does NOT share the describe-level mock `sleep` (which
    // resolves instantly): once the breaker opens, the loop's real
    // (setTimeout-backed) sleep for `resetTimeoutMs` keeps it from spinning
    // — a mock that resolves immediately would spin the loop indefinitely.
    const policy = new ResiliencePolicy({
      breaker: { failureThreshold: 1, resetTimeoutMs: 200 },
    });

    const subscriber = new EscrowEventSubscriber({
      gatewayUrl,
      publishableKey,
      clientSecret,
      maxReconnectAttempts: 10,
      resiliencePolicy: policy,
      onError,
    });

    subscriber.on('released', vi.fn());

    await vi.waitFor(() => expect(policy.breaker?.getState()).toBe('open'));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(PactoCircuitOpenError)));

    subscriber.close();
  });
});
