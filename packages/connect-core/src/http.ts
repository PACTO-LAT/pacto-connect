import {
  type ErrorContext,
  errorFromResponse,
  type GatewayErrorBody,
  PactoApiError,
  PactoError,
} from './errors.js';
import { ResiliencePolicy, type ResiliencePolicyConfig } from './resilience/index.js';
import { generateRequestId, REQUEST_ID_HEADER } from './taxonomy.js';

export const PUBLISHABLE_KEY_HEADER = 'x-pacto-publishable-key';
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type FetchLike = typeof fetch;

export interface HttpClientOptions {
  gatewayUrl: string;
  publishableKey: string;
  clientSecret: string;
  origin?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Custom fetch implementation (e.g. certificate-pinned fetch in React Native). */
  fetch?: FetchLike;
  /**
   * Shared resilience policy (timeout, retry budget, backoff, circuit
   * breaker) to use for this request. When omitted, a policy is built from
   * `maxRetries`/`baseDelayMs`/`sleep` (and resilience defaults for the rest)
   * scoped to just this call. Pass one explicitly — as `client.ts` does — to
   * share a retry budget and breaker across every request in a session.
   */
  resiliencePolicy?: ResiliencePolicy;
}

export interface RequestParams {
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown> | object;
  idempotent?: boolean;
  resource?: ErrorContext['resource'];
}

function isWriteMethod(method: HttpMethod): boolean {
  return method !== 'GET';
}

async function parseJsonSafe(response: Response): Promise<GatewayErrorBody> {
  try {
    return (await response.json()) as GatewayErrorBody;
  } catch {
    return {};
  }
}

/** Builds a request-scoped policy when the caller doesn't share one across a session. */
export function resolveHttpResiliencePolicy(
  options: Pick<HttpClientOptions, 'maxRetries' | 'baseDelayMs' | 'sleep' | 'resiliencePolicy'>,
): ResiliencePolicy {
  if (options.resiliencePolicy) {
    return options.resiliencePolicy;
  }

  const config: ResiliencePolicyConfig = {
    maxRetries: options.maxRetries,
    baseDelayMs: options.baseDelayMs,
    sleep: options.sleep,
  };

  return new ResiliencePolicy(config);
}

export async function request<T>(options: HttpClientOptions, params: RequestParams): Promise<T> {
  const policy = resolveHttpResiliencePolicy(options);
  const fetchFn = options.fetch ?? fetch;
  const idempotencyKey =
    (params.idempotent ?? isWriteMethod(params.method)) ? crypto.randomUUID() : undefined;
  const requestId = generateRequestId();

  try {
    return await policy.execute(async ({ signal }) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.clientSecret}`,
        [PUBLISHABLE_KEY_HEADER]: options.publishableKey,
        [REQUEST_ID_HEADER]: requestId,
      };

      if (options.origin) {
        headers.Origin = options.origin;
      }

      if (idempotencyKey) {
        headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;
      }

      const response = await fetchFn(`${options.gatewayUrl}${params.path}`, {
        method: params.method,
        headers,
        body: params.body ? JSON.stringify(params.body) : undefined,
        signal,
      });

      const body = await parseJsonSafe(response);
      const context: ErrorContext = { path: params.path, resource: params.resource };

      if (response.ok) {
        return body as T;
      }

      throw errorFromResponse(response.status, body, context, response.headers, requestId);
    });
  } catch (error) {
    if (error instanceof PactoError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new PactoApiError('network_error', message, {
      requestId,
      code: 'PACTO_NETWORK',
    });
  }
}
