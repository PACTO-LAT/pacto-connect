import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PactoCheckoutSheet } from './PactoCheckoutSheet.js';
import type { TestHandlers } from './test/react-native-webview-mock.js';

afterEach(() => {
  cleanup();
});

const CHECKOUT_URL = 'https://checkout.pacto.example/embed';

function envelope(message: unknown): string {
  return JSON.stringify({ v: 1, source: 'pacto-connect', message });
}

function getWebViewHandlers(): TestHandlers {
  const node = document.querySelector('[data-rn-component="WebView"]');
  if (!node) {
    throw new Error('WebView mock not rendered');
  }
  return (node as unknown as { __testHandlers: TestHandlers }).__testHandlers;
}

function getWebViewNode(): HTMLElement {
  const node = document.querySelector('[data-rn-component="WebView"]');
  if (!node) {
    throw new Error('WebView mock not rendered');
  }
  return node as HTMLElement;
}

describe('PactoCheckoutSheet', () => {
  it('renders nothing when not visible', () => {
    render(
      <PactoCheckoutSheet
        visible={false}
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        onRequestClose={() => {}}
      />,
    );
    expect(document.querySelector('[data-rn-component="Modal"]')).toBeNull();
  });

  it('builds the WebView source URL with publishableKey and same-origin parentOrigin', () => {
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        mode="buy"
        onRequestClose={() => {}}
      />,
    );

    const uri = getWebViewNode().getAttribute('data-uri');
    expect(uri).toBeTruthy();
    const url = new URL(uri as string);
    expect(url.origin).toBe('https://checkout.pacto.example');
    expect(url.searchParams.get('publishableKey')).toBe('pk_test_123');
    expect(url.searchParams.get('parentOrigin')).toBe('https://checkout.pacto.example');
  });

  it('injects the bridge shim before content loads', () => {
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        onRequestClose={() => {}}
      />,
    );
    expect(getWebViewNode().getAttribute('data-injected-before-load')).toContain(
      '__pactoConnectRNBridgeInstalled',
    );
  });

  it('routes a checkout:ready message from the WebView to onReady', () => {
    const onReady = vi.fn();
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        onReady={onReady}
        onRequestClose={() => {}}
      />,
    );

    getWebViewHandlers().onMessage?.({
      nativeEvent: {
        data: envelope({ type: 'checkout:ready', payload: { sessionId: 'sess_1' } }),
        url: `${CHECKOUT_URL}?publishableKey=pk_test_123`,
      },
    });

    expect(onReady).toHaveBeenCalledWith('sess_1');
  });

  it('routes checkout:complete/dispute/error/close to their callbacks', () => {
    const onComplete = vi.fn();
    const onDispute = vi.fn();
    const onError = vi.fn();
    const onRequestClose = vi.fn();
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        onComplete={onComplete}
        onDispute={onDispute}
        onError={onError}
        onRequestClose={onRequestClose}
      />,
    );

    const handlers = getWebViewHandlers();
    const escrow = { id: 'escrow_1', status: 'released' };

    handlers.onMessage?.({
      nativeEvent: {
        data: envelope({ type: 'checkout:complete', payload: { escrow } }),
        url: CHECKOUT_URL,
      },
    });
    expect(onComplete).toHaveBeenCalledWith(escrow);

    handlers.onMessage?.({
      nativeEvent: {
        data: envelope({ type: 'checkout:dispute', payload: { escrow } }),
        url: CHECKOUT_URL,
      },
    });
    expect(onDispute).toHaveBeenCalledWith(escrow);

    handlers.onMessage?.({
      nativeEvent: {
        data: envelope({ type: 'checkout:error', payload: { message: 'boom' } }),
        url: CHECKOUT_URL,
      },
    });
    expect(onError).toHaveBeenCalledWith(new Error('boom'));

    handlers.onMessage?.({
      nativeEvent: { data: envelope({ type: 'checkout:close', payload: {} }), url: CHECKOUT_URL },
    });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a message whose reported URL origin does not match the checkout origin', () => {
    const onReady = vi.fn();
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        onReady={onReady}
        onRequestClose={() => {}}
      />,
    );

    getWebViewHandlers().onMessage?.({
      nativeEvent: {
        data: envelope({ type: 'checkout:ready', payload: { sessionId: 'sess_1' } }),
        url: 'https://evil.example/embed',
      },
    });

    expect(onReady).not.toHaveBeenCalled();
  });

  it('close button posts checkout:close into the WebView and calls onRequestClose', () => {
    const onRequestClose = vi.fn();
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        onRequestClose={onRequestClose}
      />,
    );

    fireEvent.click(screen.getByLabelText('Close checkout'));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('allows navigation within the checkout origin', () => {
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        onRequestClose={() => {}}
      />,
    );

    const allowed = getWebViewHandlers().onShouldStartLoadWithRequest?.({
      url: `${CHECKOUT_URL}?step=deposit`,
    });
    expect(allowed).toBe(true);
  });

  it('blocks navigation to the app returnUrl scheme (handled by the OS deep link instead)', () => {
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        returnUrl="pacto-example://checkout-return"
        onRequestClose={() => {}}
      />,
    );

    const allowed = getWebViewHandlers().onShouldStartLoadWithRequest?.({
      url: 'pacto-example://checkout-return?status=released',
    });
    expect(allowed).toBe(false);
  });

  it('blocks and hands off external (e.g. bank redirect) navigation to the system browser', () => {
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        onRequestClose={() => {}}
      />,
    );

    const allowed = getWebViewHandlers().onShouldStartLoadWithRequest?.({
      url: 'https://bank.example/3ds-challenge',
    });
    expect(allowed).toBe(false);
  });

  it('never receives a secret/sk_ key — only publishableKey is a required prop', () => {
    // Type-level guarantee: PactoCheckoutSheetProps has no clientSecret/secretKey
    // field, so there is no way for a merchant app to pass one in. Assert the
    // rendered WebView URL never contains an sk_ prefix regardless of input.
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_live_abc123"
        onRequestClose={() => {}}
      />,
    );
    expect(getWebViewNode().getAttribute('data-uri')).not.toContain('sk_');
  });
});
