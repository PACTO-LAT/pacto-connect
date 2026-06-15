/**
 * @pacto-connect/core
 *
 * Framework-agnostic SDK core. Scaffolding only — feature work lives in the issues:
 *  - #2 handshake + PactoSession
 *  - #3 typed REST client + idempotency
 *  - #4 realtime escrow events (SSE)
 */

export const VERSION = '0.0.0';

export interface PactoInitOptions {
  /** Publishable key issued by the Connect Gateway (pk_live_* / pk_test_*). */
  publishableKey: string;
  /** Gateway base URL. Defaults to the hosted Pacto Connect gateway. */
  gatewayUrl?: string;
}

export interface PactoClient {
  readonly publishableKey: string;
  readonly gatewayUrl: string;
}

const DEFAULT_GATEWAY_URL = 'https://connect.pacto.example';

/** Entry point. Real session/handshake logic is implemented in issue #2. */
export function init(options: PactoInitOptions): PactoClient {
  if (!options.publishableKey) {
    throw new Error('[pacto-connect] publishableKey is required');
  }
  return {
    publishableKey: options.publishableKey,
    gatewayUrl: options.gatewayUrl ?? DEFAULT_GATEWAY_URL,
  };
}

export const Pacto = { init, VERSION };
