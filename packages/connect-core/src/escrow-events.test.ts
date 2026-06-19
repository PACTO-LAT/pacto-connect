import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EscrowEventSubscriber } from './escrow-events.js';
import { parseSseBlock, readSseStream } from './sse.js';

function encodeSse(block: string): Uint8Array {
  return new TextEncoder().encode(block);
}

describe('sse parser', () => {
  it('parses event blocks with id, event, and data', () => {
    const message = parseSseBlock(
      'id: cursor-1\nevent: escrow.funded\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:00:00.000Z"}',
    );

    expect(message).toEqual({
      id: 'cursor-1',
      event: 'escrow.funded',
      data: '{"escrowId":"esc_1","occurredAt":"2024-01-01T00:00:00.000Z"}',
    });
  });

  it('ignores heartbeat comments', () => {
    expect(parseSseBlock(': heartbeat')).toBeNull();
  });
});

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
});

describe('readSseStream', () => {
  it('reads chunked sse payloads', async () => {
    const messages: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeSse('id: 1\nevent: ping\ndata: {}\n\n'));
        controller.close();
      },
    });

    await readSseStream(stream, (message) => {
      messages.push(message.event ?? '');
    });

    expect(messages).toEqual(['ping']);
  });
});
