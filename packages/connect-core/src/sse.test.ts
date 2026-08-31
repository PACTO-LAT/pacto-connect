import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PactoTimeoutError } from './errors.js';
import { parseSseBlock, readSseStream } from './sse.js';

function encodeSse(block: string): Uint8Array {
  return new TextEncoder().encode(block);
}

describe('parseSseBlock', () => {
  it('parses event blocks with id, event, and data', () => {
    const message = parseSseBlock('id: 1\nevent: ping\ndata: {"a":1}');
    expect(message).toEqual({ id: '1', event: 'ping', data: '{"a":1}' });
  });

  it('ignores heartbeat comment lines', () => {
    expect(parseSseBlock(': heartbeat')).toBeNull();
  });

  it('returns null for a block with neither data nor event', () => {
    expect(parseSseBlock('id: 1')).toBeNull();
  });
});

describe('readSseStream', () => {
  it('reads chunked sse payloads without an idle timeout configured', async () => {
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

  it('delivers messages normally when they arrive within the idle timeout', async () => {
    const messages: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeSse('id: 1\nevent: ping\ndata: {}\n\n'));
        controller.close();
      },
    });

    await readSseStream(
      stream,
      (message) => {
        messages.push(message.event ?? '');
      },
      { idleTimeoutMs: 5_000 },
    );

    expect(messages).toEqual(['ping']);
  });

  describe('idle timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('throws a PactoTimeoutError when no data arrives before idleTimeoutMs elapses', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start() {
          // Never enqueues or closes — simulates a server that accepted the
          // connection and then went silent.
        },
      });

      const onMessage = vi.fn();
      const promise = readSseStream(stream, onMessage, { idleTimeoutMs: 1_000 });
      const assertion = expect(promise).rejects.toBeInstanceOf(PactoTimeoutError);

      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
      expect(onMessage).not.toHaveBeenCalled();
    });

    it('cancels the reader on idle timeout', async () => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start() {},
        cancel() {
          cancelled = true;
        },
      });

      const promise = readSseStream(stream, vi.fn(), { idleTimeoutMs: 1_000 });
      const assertion = expect(promise).rejects.toBeInstanceOf(PactoTimeoutError);

      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
      expect(cancelled).toBe(true);
    });

    it('does not time out a stream that keeps producing data within the window', async () => {
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
        },
      });

      const messages: string[] = [];
      const promise = readSseStream(stream, (message) => messages.push(message.event ?? ''), {
        idleTimeoutMs: 1_000,
      });

      // Each chunk arrives just under the idle window, resetting it.
      await vi.advanceTimersByTimeAsync(600);
      controllerRef?.enqueue(encodeSse('id: 1\nevent: a\ndata: {}\n\n'));
      await vi.advanceTimersByTimeAsync(600);
      controllerRef?.enqueue(encodeSse('id: 2\nevent: b\ndata: {}\n\n'));
      controllerRef?.close();

      await promise;
      expect(messages).toEqual(['a', 'b']);
    });
  });
});
