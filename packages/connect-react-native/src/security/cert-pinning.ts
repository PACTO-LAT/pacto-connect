import { type FetchLike, PactoSecurityError } from '@pacto-connect/core';

export interface PinSet {
  /** Gateway hostname to pin, e.g. connect.pacto.example */
  host: string;
  /** SPKI SHA-256 base64 hashes — current plus optional next for rotation. */
  pins: string[];
  /** When false, delegates to the platform fetch without pinning. Default true. */
  enabled?: boolean;
}

export interface SslPinningFetchOptions extends RequestInit {
  sslPinning?: { certs: string[] };
}

export interface SslPinningClient {
  fetch(url: string, options?: SslPinningFetchOptions): Promise<Response>;
}

export interface PinningModule {
  fetch: SslPinningClient['fetch'];
}

const PIN_MISMATCH_PATTERNS = [/pinning/i, /ssl/i, /certificate/i, /trust/i];
const PIN_STALE_PATTERNS = [/stale/i, /no pins/i, /pin set/i];

function isPinMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return PIN_MISMATCH_PATTERNS.some((pattern) => pattern.test(message));
}

function isPinStaleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return PIN_STALE_PATTERNS.some((pattern) => pattern.test(message));
}

function normalizeHost(url: string, expectedHost: string): boolean {
  try {
    return new URL(url).hostname === expectedHost;
  } catch {
    return false;
  }
}

/**
 * Creates a fetch wrapper that pins gateway TLS certificates. Accepts any
 * hash in the pin set so rotation can ship `current + next` ahead of cert change.
 */
export function createPinnedFetch(pinSet: PinSet, fallbackFetch: FetchLike = fetch): FetchLike {
  if (pinSet.enabled === false) {
    return fallbackFetch;
  }

  if (!pinSet.pins.length) {
    return async () => {
      throw new PactoSecurityError(
        'pin_stale',
        'Certificate pin set is empty — update pins or disable pinning explicitly',
      );
    };
  }

  let pinningModule: PinningModule | null = null;

  async function loadPinningModule(): Promise<PinningModule> {
    if (pinningModule) {
      return pinningModule;
    }

    const sslPinning = await import('react-native-ssl-pinning');
    pinningModule = sslPinning as PinningModule;
    return pinningModule;
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (!normalizeHost(url, pinSet.host)) {
      return fallbackFetch(input, init);
    }

    try {
      const module = await loadPinningModule();
      const headers: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value: string, key: string) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            headers[key] = value;
          }
        } else {
          Object.assign(headers, init.headers);
        }
      }

      const method = init?.method ?? 'GET';
      const body = init?.body;

      return await module.fetch(url, {
        method,
        headers,
        body: typeof body === 'string' ? body : undefined,
        sslPinning: {
          certs: pinSet.pins,
        },
      });
    } catch (error) {
      if (isPinStaleError(error)) {
        throw new PactoSecurityError(
          'pin_stale',
          'No configured certificate pin matches the gateway — ship an updated pin set',
        );
      }

      if (isPinMismatchError(error)) {
        throw new PactoSecurityError('pin_mismatch', 'Gateway certificate pin validation failed');
      }

      throw error;
    }
  };
}

/** Test helper — simulates pin validation without native modules. */
export function createMockPinnedFetch(options: {
  pinSet: PinSet;
  serverPin: string | null;
  fallbackFetch?: FetchLike;
}): FetchLike {
  const fallback = options.fallbackFetch ?? fetch;
  if (options.pinSet.enabled === false) {
    return fallback;
  }

  if (!options.pinSet.pins.length) {
    return async () => {
      throw new PactoSecurityError('pin_stale', 'Certificate pin set is empty');
    };
  }

  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!normalizeHost(url, options.pinSet.host)) {
      return fallback(input, init);
    }

    if (!options.serverPin || !options.pinSet.pins.includes(options.serverPin)) {
      if (!options.serverPin) {
        throw new PactoSecurityError('pin_stale', 'No configured pin matches gateway certificate');
      }
      throw new PactoSecurityError('pin_mismatch', 'Gateway certificate pin validation failed');
    }

    return fallback(input, init);
  };
}
