import { PactoTimeoutError } from './errors.js';
import { withTimeout } from './resilience/index.js';

export interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}

export function parseSseBlock(block: string): SseMessage | null {
  const lines = block.split('\n');
  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('id:')) {
      id = line.slice(3).trim();
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0 && !event) {
    return null;
  }

  return {
    id,
    event,
    data: dataLines.join('\n'),
  };
}

export interface ReadSseStreamOptions {
  /**
   * If no bytes arrive within this many milliseconds, the read is aborted
   * and a {@link PactoTimeoutError} is thrown — without this, a server that
   * accepts the connection and then goes silent hangs the stream forever.
   * Omit (or pass `0`) to read with no idle timeout.
   */
  idleTimeoutMs?: number;
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await withTimeout(
      () => reader.read(),
      idleTimeoutMs,
      () => new PactoTimeoutError('stream_idle_timeout', 'SSE stream produced no data in time'),
    );
  } catch (error) {
    if (error instanceof PactoTimeoutError) {
      await reader.cancel().catch(() => {});
    }
    throw error;
  }
}

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void,
  options: ReadSseStreamOptions = {},
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const idleTimeoutMs = options.idleTimeoutMs ?? 0;

  while (true) {
    const { done, value } =
      idleTimeoutMs > 0 ? await readWithIdleTimeout(reader, idleTimeoutMs) : await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }

      const message = parseSseBlock(trimmed);
      if (message) {
        onMessage(message);
      }
    }
  }

  if (buffer.trim()) {
    const message = parseSseBlock(buffer.trim());
    if (message) {
      onMessage(message);
    }
  }
}
