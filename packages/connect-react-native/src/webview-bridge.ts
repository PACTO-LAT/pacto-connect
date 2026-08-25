import {
  type CheckoutMode,
  type Escrow,
  isOriginAllowed,
  isPactoBridgeEnvelope,
  PACTO_BRIDGE_SOURCE,
  PACTO_BRIDGE_VERSION,
  type PactoBridgeMessage,
} from '@pacto-connect/core';

/**
 * Bridges the postMessage-based `PactoBridgeEnvelope` protocol (shared with
 * `connect-elements`' iframe embed) onto a React Native WebView, which has no
 * `window.postMessage` transport of its own — only a one-way JS-string
 * channel (`ReactNativeWebView.postMessage` out, `injectJavaScript` in).
 */

export interface BuildCheckoutUrlOptions {
  /** URL of the hosted checkout page (the one running `bootstrapCheckoutFrame`). */
  checkoutUrl: string;
  publishableKey: string;
  listingId?: string;
  sessionId?: string;
  mode?: CheckoutMode;
  testMode?: boolean;
  /** App deep-link the hosted page should return to after an external payment step. */
  returnUrl?: string;
  params?: Record<string, string>;
}

export function checkoutOrigin(checkoutUrl: string): string {
  return new URL(checkoutUrl).origin;
}

export function buildCheckoutUrl(options: BuildCheckoutUrlOptions): string {
  const url = new URL(options.checkoutUrl);
  const { searchParams } = url;

  searchParams.set('publishableKey', options.publishableKey);
  if (options.listingId) {
    searchParams.set('listingId', options.listingId);
  }
  if (options.sessionId) {
    searchParams.set('sessionId', options.sessionId);
  }
  if (options.mode) {
    searchParams.set('mode', options.mode);
  }
  if (options.testMode) {
    searchParams.set('testMode', 'true');
  }
  if (options.returnUrl) {
    searchParams.set('returnUrl', options.returnUrl);
  }
  // The hosted page's bridge (`PactoCheckoutElement`) posts messages to
  // `window.postMessage(envelope, parentOrigin)`. A WebView has no real
  // parent window — the page runs top-level, and a same-window postMessage is
  // only delivered when the target origin matches the page's own origin (or
  // is `'*'`). So `parentOrigin` must point at the checkout page itself, not
  // at some app-only scheme, or the browser silently drops the message.
  searchParams.set('parentOrigin', url.origin);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    searchParams.set(key, value);
  }

  return url.toString();
}

/**
 * Injected via `injectedJavaScriptBeforeContentLoaded` so the listener is
 * attached before the checkout page's own scripts run (otherwise an early
 * `checkout:ready` post could be missed). Forwards every message the page
 * posts to itself out to native — origin/shape validation happens on the
 * native side in {@link parseWebViewBridgeMessage}, reusing the same
 * `isPactoBridgeEnvelope` check the web bridge uses.
 */
export const BRIDGE_SHIM_SCRIPT = `
(function () {
  if (window.__pactoConnectRNBridgeInstalled) { return true; }
  window.__pactoConnectRNBridgeInstalled = true;
  window.addEventListener('message', function (event) {
    if (event.source !== window) { return; }
    if (!window.ReactNativeWebView) { return; }
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(event.data));
    } catch (err) {}
  });
})();
true;
`;

/**
 * Script for `webViewRef.injectJavaScript()` to deliver a native->web message
 * (e.g. `checkout:close`). `'*'` is safe as the postMessage target origin
 * here: the WebView is captive to the checkout origin (external navigation is
 * intercepted, see `PactoCheckoutSheet`), so whatever origin currently holds
 * the page is the one we intend to reach.
 */
export function buildInboundBridgeScript(message: PactoBridgeMessage): string {
  const envelope = { v: PACTO_BRIDGE_VERSION, source: PACTO_BRIDGE_SOURCE, message };
  return `window.postMessage(${JSON.stringify(envelope)}, '*'); true;`;
}

export interface CheckoutStorageSyncPayload {
  key: string;
  value: string;
}

export const CHECKOUT_STORAGE_SYNC_SOURCE = 'pacto-connect-rn-sync';

export function buildCheckoutStorageSeedScript(storageKey: string, raw: string): string {
  return `(function(){try{sessionStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(raw)});}catch(e){}})();true;`;
}

export function buildCheckoutStorageSyncScript(): string {
  return `(function(){try{var key=null;var value=null;for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i);if(k&&k.indexOf('pacto:checkout:')===0){key=k;value=sessionStorage.getItem(k);break;}}if(key&&value&&window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({source:${JSON.stringify(CHECKOUT_STORAGE_SYNC_SOURCE)},payload:{key:key,value:value}}));}}catch(e){}})();true;`;
}

export function parseCheckoutStorageSyncMessage(raw: string): CheckoutStorageSyncPayload | null {
  try {
    const parsed = JSON.parse(raw) as { source?: string; payload?: CheckoutStorageSyncPayload };
    if (parsed.source !== CHECKOUT_STORAGE_SYNC_SOURCE) {
      return null;
    }

    if (!parsed.payload || typeof parsed.payload.key !== 'string') {
      return null;
    }

    if (typeof parsed.payload.value !== 'string') {
      return null;
    }

    return parsed.payload;
  } catch {
    return null;
  }
}

/**
 * Validates and unwraps a raw `onMessage` payload from the WebView. `currentUrl`
 * (the WebView's current page URL, from `nativeEvent.url`) stands in for the
 * `MessageEvent.origin` check the DOM bridge does — WebView `onMessage` events
 * carry no origin of their own.
 */
export function parseWebViewBridgeMessage(
  raw: string,
  currentUrl: string,
  expectedOrigin: string,
): PactoBridgeMessage | null {
  let origin: string;
  try {
    origin = new URL(currentUrl).origin;
  } catch {
    return null;
  }

  if (!isOriginAllowed(origin, [expectedOrigin])) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPactoBridgeEnvelope(parsed)) {
    return null;
  }

  return parsed.message;
}

export interface BridgeCallbacks {
  onReady?: (sessionId: string) => void;
  onStep?: (step: PactoBridgeMessage<'checkout:step'>['payload']['step']) => void;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/** Mirrors `connect-elements`' `mountFrame` handleMessage switch. */
export function dispatchBridgeMessage(
  message: PactoBridgeMessage,
  callbacks: BridgeCallbacks,
): void {
  switch (message.type) {
    case 'checkout:ready':
      callbacks.onReady?.(message.payload.sessionId);
      break;
    case 'checkout:step':
      callbacks.onStep?.(message.payload.step);
      break;
    case 'checkout:complete':
      callbacks.onComplete?.(message.payload.escrow);
      break;
    case 'checkout:dispute':
      callbacks.onDispute?.(message.payload.escrow);
      break;
    case 'checkout:error':
      callbacks.onError?.(new Error(message.payload.message));
      break;
    case 'checkout:close':
      callbacks.onClose?.();
      break;
  }
}
