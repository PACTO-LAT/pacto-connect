import type { CheckoutStep } from './checkout-flow.js';
import type { Escrow } from './resources.js';

export const PACTO_BRIDGE_SOURCE = 'pacto-connect' as const;
export const PACTO_BRIDGE_VERSION = 1 as const;

export type PactoBridgeEventType =
  | 'checkout:ready'
  | 'checkout:close'
  | 'checkout:complete'
  | 'checkout:dispute'
  | 'checkout:error'
  | 'checkout:step';

export interface PactoBridgePayloadMap {
  'checkout:ready': { sessionId: string };
  'checkout:close': Record<string, never>;
  'checkout:complete': { escrow: Escrow };
  'checkout:dispute': { escrow: Escrow };
  'checkout:error': { message: string };
  'checkout:step': { step: CheckoutStep };
}

export type PactoBridgeMessage<T extends PactoBridgeEventType = PactoBridgeEventType> = {
  [K in PactoBridgeEventType]: { type: K; payload: PactoBridgePayloadMap[K] };
}[T];

export interface PactoBridgeEnvelope {
  v: typeof PACTO_BRIDGE_VERSION;
  source: typeof PACTO_BRIDGE_SOURCE;
  message: PactoBridgeMessage;
}

const BRIDGE_EVENT_TYPES = new Set<PactoBridgeEventType>([
  'checkout:ready',
  'checkout:close',
  'checkout:complete',
  'checkout:dispute',
  'checkout:error',
  'checkout:step',
]);

const CHECKOUT_STEPS = new Set<CheckoutStep>([
  'loading',
  'selectListing',
  'deposit',
  'uploadReceipt',
  'tracking',
  'success',
  'disputed',
  'error',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEscrow(value: unknown): value is Escrow {
  return isRecord(value) && typeof value.id === 'string';
}

function isBridgeMessage(value: unknown): value is PactoBridgeMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (!BRIDGE_EVENT_TYPES.has(value.type as PactoBridgeEventType)) {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  switch (value.type) {
    case 'checkout:ready':
      return typeof value.payload.sessionId === 'string';
    case 'checkout:close':
      return true;
    case 'checkout:complete':
    case 'checkout:dispute':
      return isEscrow(value.payload.escrow);
    case 'checkout:error':
      return typeof value.payload.message === 'string';
    case 'checkout:step':
      return CHECKOUT_STEPS.has(value.payload.step as CheckoutStep);
    default:
      return false;
  }
}

export function isPactoBridgeEnvelope(value: unknown): value is PactoBridgeEnvelope {
  return (
    isRecord(value) &&
    value.v === PACTO_BRIDGE_VERSION &&
    value.source === PACTO_BRIDGE_SOURCE &&
    isBridgeMessage(value.message)
  );
}

export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin);
}

export interface BridgeClientOptions {
  targetWindow?: Window;
  targetOrigin: string;
  allowedOrigins: string[];
}

export interface BridgeHostOptions {
  allowedOrigins: string[];
  onMessage: (message: PactoBridgeMessage, event: MessageEvent) => void;
}

export interface BridgeClient {
  post(message: PactoBridgeMessage): void;
  listen(handler: (message: PactoBridgeMessage) => void): () => void;
  close(): void;
}

export interface BridgeHost {
  close(): void;
}

function createEnvelope(message: PactoBridgeMessage): PactoBridgeEnvelope {
  return {
    v: PACTO_BRIDGE_VERSION,
    source: PACTO_BRIDGE_SOURCE,
    message,
  };
}

export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  const targetWindow = options.targetWindow ?? (window.parent !== window ? window.parent : window);
  let inboundHandler: ((message: PactoBridgeMessage) => void) | null = null;
  let listener: ((event: MessageEvent) => void) | null = null;

  return {
    post(message: PactoBridgeMessage): void {
      targetWindow.postMessage(createEnvelope(message), options.targetOrigin);
    },
    listen(handler: (message: PactoBridgeMessage) => void): () => void {
      inboundHandler = handler;
      listener = (event: MessageEvent) => {
        if (!isOriginAllowed(event.origin, options.allowedOrigins)) {
          return;
        }

        if (!isPactoBridgeEnvelope(event.data)) {
          return;
        }

        inboundHandler?.(event.data.message);
      };

      window.addEventListener('message', listener);
      return () => {
        if (listener) {
          window.removeEventListener('message', listener);
        }
        inboundHandler = null;
        listener = null;
      };
    },
    close(): void {
      if (listener) {
        window.removeEventListener('message', listener);
      }
      inboundHandler = null;
      listener = null;
    },
  };
}

export function createBridgeHost(options: BridgeHostOptions): BridgeHost {
  const listener = (event: MessageEvent) => {
    if (!isOriginAllowed(event.origin, options.allowedOrigins)) {
      return;
    }

    if (!isPactoBridgeEnvelope(event.data)) {
      return;
    }

    options.onMessage(event.data.message, event);
  };

  window.addEventListener('message', listener);

  return {
    close(): void {
      window.removeEventListener('message', listener);
    },
  };
}
