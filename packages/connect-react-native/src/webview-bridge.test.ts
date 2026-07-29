import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_SHIM_SCRIPT,
  buildCheckoutUrl,
  buildInboundBridgeScript,
  checkoutOrigin,
  dispatchBridgeMessage,
  parseWebViewBridgeMessage,
} from './webview-bridge.js';

describe('checkoutOrigin', () => {
  it('extracts the origin from a checkout URL', () => {
    expect(checkoutOrigin('https://checkout.pacto.example/embed?foo=bar')).toBe(
      'https://checkout.pacto.example',
    );
  });
});

describe('buildCheckoutUrl', () => {
  it('sets publishableKey, mode, and testMode query params', () => {
    const url = new URL(
      buildCheckoutUrl({
        checkoutUrl: 'https://checkout.pacto.example/embed',
        publishableKey: 'pk_test_123',
        mode: 'buy',
        testMode: true,
      }),
    );

    expect(url.searchParams.get('publishableKey')).toBe('pk_test_123');
    expect(url.searchParams.get('mode')).toBe('buy');
    expect(url.searchParams.get('testMode')).toBe('true');
  });

  it('points parentOrigin at the checkout page itself, not the returnUrl scheme', () => {
    const url = new URL(
      buildCheckoutUrl({
        checkoutUrl: 'https://checkout.pacto.example/embed',
        publishableKey: 'pk_test_123',
        returnUrl: 'pacto-example://checkout-return',
      }),
    );

    expect(url.searchParams.get('parentOrigin')).toBe('https://checkout.pacto.example');
    expect(url.searchParams.get('returnUrl')).toBe('pacto-example://checkout-return');
  });

  it('applies listingId, sessionId, and extra params', () => {
    const url = new URL(
      buildCheckoutUrl({
        checkoutUrl: 'https://checkout.pacto.example/embed',
        publishableKey: 'pk_test_123',
        listingId: 'listing_1',
        sessionId: 'sess_1',
        params: { locale: 'es' },
      }),
    );

    expect(url.searchParams.get('listingId')).toBe('listing_1');
    expect(url.searchParams.get('sessionId')).toBe('sess_1');
    expect(url.searchParams.get('locale')).toBe('es');
  });

  it('omits testMode and returnUrl when not provided', () => {
    const url = new URL(
      buildCheckoutUrl({
        checkoutUrl: 'https://checkout.pacto.example/embed',
        publishableKey: 'pk_test_123',
      }),
    );

    expect(url.searchParams.has('testMode')).toBe(false);
    expect(url.searchParams.has('returnUrl')).toBe(false);
  });
});

describe('BRIDGE_SHIM_SCRIPT', () => {
  it('is idempotent, forwards only self-posted messages, and ends with true for iOS injectJavaScript', () => {
    expect(BRIDGE_SHIM_SCRIPT).toContain('__pactoConnectRNBridgeInstalled');
    expect(BRIDGE_SHIM_SCRIPT).toContain('event.source !== window');
    expect(BRIDGE_SHIM_SCRIPT.trim().endsWith('true;')).toBe(true);
  });
});

describe('buildInboundBridgeScript', () => {
  it('embeds a valid envelope and evaluates to a script ending in true', () => {
    const script = buildInboundBridgeScript({ type: 'checkout:close', payload: {} });
    expect(script).toContain('window.postMessage(');
    expect(script).toContain('"type":"checkout:close"');
    expect(script.trim().endsWith('true;')).toBe(true);
  });

  it('JSON-escapes payload content so it cannot break out of the script string', () => {
    const rawPayload = 'a"); alert(1); ("';
    const script = buildInboundBridgeScript({
      type: 'checkout:error',
      payload: { message: rawPayload },
    });
    // The raw, unescaped payload (with bare double quotes) must never appear
    // verbatim — only JSON.stringify's backslash-escaped form should.
    expect(script.includes(rawPayload)).toBe(false);
    expect(script).toContain(JSON.stringify(rawPayload));
  });
});

describe('parseWebViewBridgeMessage', () => {
  const expectedOrigin = 'https://checkout.pacto.example';

  it('parses a valid envelope from the expected origin', () => {
    const raw = JSON.stringify({
      v: 1,
      source: 'pacto-connect',
      message: { type: 'checkout:ready', payload: { sessionId: 'sess_1' } },
    });

    const message = parseWebViewBridgeMessage(raw, `${expectedOrigin}/embed?x=1`, expectedOrigin);
    expect(message).toEqual({ type: 'checkout:ready', payload: { sessionId: 'sess_1' } });
  });

  it('rejects messages whose current URL origin does not match', () => {
    const raw = JSON.stringify({
      v: 1,
      source: 'pacto-connect',
      message: { type: 'checkout:close', payload: {} },
    });

    expect(parseWebViewBridgeMessage(raw, 'https://evil.example/embed', expectedOrigin)).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(
      parseWebViewBridgeMessage('not json', `${expectedOrigin}/embed`, expectedOrigin),
    ).toBeNull();
  });

  it('rejects a well-formed but non-envelope payload', () => {
    const raw = JSON.stringify({ hello: 'world' });
    expect(parseWebViewBridgeMessage(raw, `${expectedOrigin}/embed`, expectedOrigin)).toBeNull();
  });

  it('rejects an unparsable current URL', () => {
    const raw = JSON.stringify({
      v: 1,
      source: 'pacto-connect',
      message: { type: 'checkout:close', payload: {} },
    });
    expect(parseWebViewBridgeMessage(raw, 'not-a-url', expectedOrigin)).toBeNull();
  });
});

describe('dispatchBridgeMessage', () => {
  it('routes each message type to its matching callback', () => {
    const callbacks = {
      onReady: vi.fn(),
      onStep: vi.fn(),
      onComplete: vi.fn(),
      onDispute: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };

    dispatchBridgeMessage({ type: 'checkout:ready', payload: { sessionId: 's1' } }, callbacks);
    expect(callbacks.onReady).toHaveBeenCalledWith('s1');

    dispatchBridgeMessage({ type: 'checkout:step', payload: { step: 'tracking' } }, callbacks);
    expect(callbacks.onStep).toHaveBeenCalledWith('tracking');

    const escrow = { id: 'e1' } as never;
    dispatchBridgeMessage({ type: 'checkout:complete', payload: { escrow } }, callbacks);
    expect(callbacks.onComplete).toHaveBeenCalledWith(escrow);

    dispatchBridgeMessage({ type: 'checkout:dispute', payload: { escrow } }, callbacks);
    expect(callbacks.onDispute).toHaveBeenCalledWith(escrow);

    dispatchBridgeMessage({ type: 'checkout:error', payload: { message: 'boom' } }, callbacks);
    expect(callbacks.onError).toHaveBeenCalledWith(new Error('boom'));

    dispatchBridgeMessage({ type: 'checkout:close', payload: {} }, callbacks);
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  it('tolerates missing callbacks', () => {
    expect(() => dispatchBridgeMessage({ type: 'checkout:close', payload: {} }, {})).not.toThrow();
  });
});
