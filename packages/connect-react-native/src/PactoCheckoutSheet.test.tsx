import {
  buildCheckoutSnapshotScope,
  checkoutStorageKey,
  createMemoryCheckoutStorage,
  serializeCheckoutSnapshot,
} from '@pacto-connect/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PactoCheckoutSheet } from './PactoCheckoutSheet.js';
import { createMockIntegrityProbe } from './security/device-integrity.js';
import type { TestHandlers } from './test/react-native-webview-mock.js';

afterEach(() => {
  cleanup();
  (AccessibilityInfo as unknown as { __reset: () => void }).__reset();
});

const CHECKOUT_URL = 'https://checkout.pacto.example/embed';

const defaultSecurityProps = {
  userPresence: { enabled: false as const },
  integrityProbe: createMockIntegrityProbe({}),
};

function renderCheckoutSheet(props: React.ComponentProps<typeof PactoCheckoutSheet>) {
  return render(<PactoCheckoutSheet {...defaultSecurityProps} {...props} />);
}

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
    renderCheckoutSheet({
      visible: false,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      onRequestClose: () => {},
    });
    expect(document.querySelector('[data-rn-component="Modal"]')).toBeNull();
  });

  it('builds the WebView source URL with publishableKey and same-origin parentOrigin', () => {
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      mode: 'buy',
      onRequestClose: () => {},
    });

    const uri = getWebViewNode().getAttribute('data-uri');
    expect(uri).toBeTruthy();
    const url = new URL(uri as string);
    expect(url.origin).toBe('https://checkout.pacto.example');
    expect(url.searchParams.get('publishableKey')).toBe('pk_test_123');
    expect(url.searchParams.get('parentOrigin')).toBe('https://checkout.pacto.example');
  });

  it('injects the bridge shim before content loads', () => {
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      onRequestClose: () => {},
    });
    expect(getWebViewNode().getAttribute('data-injected-before-load')).toContain(
      '__pactoConnectRNBridgeInstalled',
    );
  });

  it('routes a checkout:ready message from the WebView to onReady', () => {
    const onReady = vi.fn();
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      onReady,
      onRequestClose: () => {},
    });

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
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      onComplete,
      onDispute,
      onError,
      onRequestClose,
    });

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
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      onReady,
      onRequestClose: () => {},
    });

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
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      onRequestClose,
    });

    fireEvent.click(screen.getByLabelText('Close checkout'));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('allows navigation within the checkout origin', () => {
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      onRequestClose: () => {},
    });

    const allowed = getWebViewHandlers().onShouldStartLoadWithRequest?.({
      url: `${CHECKOUT_URL}?step=deposit`,
    });
    expect(allowed).toBe(true);
  });

  it('blocks navigation to the app returnUrl scheme (handled by the OS deep link instead)', () => {
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      returnUrl: 'pacto-example://checkout-return',
      onRequestClose: () => {},
    });

    const allowed = getWebViewHandlers().onShouldStartLoadWithRequest?.({
      url: 'pacto-example://checkout-return?status=released',
    });
    expect(allowed).toBe(false);
  });

  it('blocks and hands off external (e.g. bank redirect) navigation to the system browser', () => {
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      onRequestClose: () => {},
    });

    const allowed = getWebViewHandlers().onShouldStartLoadWithRequest?.({
      url: 'https://bank.example/3ds-challenge',
    });
    expect(allowed).toBe(false);
  });

  it('never receives a secret/sk_ key — only publishableKey is a required prop', () => {
    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_live_abc123',
      onRequestClose: () => {},
    });
    expect(getWebViewNode().getAttribute('data-uri')).not.toContain('sk_');
  });

  it('seeds hosted storage and sessionId when remounting with a persisted snapshot', async () => {
    const storage = createMemoryCheckoutStorage();
    const scope = buildCheckoutSnapshotScope({
      publishableKey: 'pk_test_123',
      listingId: 'lst_1',
      mode: 'buy',
    });
    const key = checkoutStorageKey(scope);
    storage.setItem(
      key,
      serializeCheckoutSnapshot({
        version: 1,
        step: 'deposit',
        sessionId: 'sess_resumed',
        selectedListing: null,
        quote: {
          id: 'quo_1',
          asset: 'USDC',
          amount: '100',
          price: '5000',
          side: 'buy',
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        escrow: {
          id: 'esc_1',
          quoteId: 'quo_1',
          status: 'pending',
          amount: '100',
          asset: 'USDC',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        milestones: [],
        testMode: true,
        session: {
          sessionId: 'sess_resumed',
          clientSecret: 'cs_sess_resumed.sig',
          expiresAt: '2099-01-01T00:00:00.000Z',
          mode: 'buy',
        },
        scope,
      }),
    );

    const { unmount } = renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      listingId: 'lst_1',
      storage,
      onRequestClose: () => {},
    });

    await waitFor(() => {
      const injected = getWebViewNode().getAttribute('data-injected-before-load');
      expect(injected).toContain('sessionStorage.setItem');
      expect(injected).toContain(key);
    });

    const uri = getWebViewNode().getAttribute('data-uri');
    expect(new URL(uri as string).searchParams.get('sessionId')).toBe('sess_resumed');

    unmount();

    renderCheckoutSheet({
      visible: true,
      checkoutUrl: CHECKOUT_URL,
      publishableKey: 'pk_test_123',
      listingId: 'lst_1',
      storage,
      onRequestClose: () => {},
    });

    await waitFor(() => {
      expect(getWebViewNode().getAttribute('data-injected-before-load')).toContain(key);
    });
  });

  describe('accessibility', () => {
    function accessibilityAnnouncements(): string[] {
      return (AccessibilityInfo as unknown as { __announcements: string[] }).__announcements;
    }

    it('gives the close control an accessible role and name', () => {
      renderCheckoutSheet({
        visible: true,
        checkoutUrl: CHECKOUT_URL,
        publishableKey: 'pk_test_123',
        onRequestClose: () => {},
      });

      const closeButton = screen.getByLabelText('Close checkout');
      expect(closeButton).toHaveAttribute('role', 'button');
    });

    it('marks the title as a header for assistive technology', () => {
      renderCheckoutSheet({
        visible: true,
        checkoutUrl: CHECKOUT_URL,
        publishableKey: 'pk_test_123',
        title: 'Buy USDC',
        onRequestClose: () => {},
      });

      expect(screen.getByText('Buy USDC')).toHaveAttribute('role', 'header');
    });

    it('marks the sheet content as a modal for screen readers', () => {
      renderCheckoutSheet({
        visible: true,
        checkoutUrl: CHECKOUT_URL,
        publishableKey: 'pk_test_123',
        onRequestClose: () => {},
      });

      const safeArea = document.querySelector('[data-rn-component="SafeAreaView"]');
      expect(safeArea).toHaveAttribute('data-accessibility-view-is-modal', 'true');
    });

    it('announces a checkout:step message from the WebView through AccessibilityInfo', () => {
      renderCheckoutSheet({
        visible: true,
        checkoutUrl: CHECKOUT_URL,
        publishableKey: 'pk_test_123',
        onRequestClose: () => {},
      });

      getWebViewHandlers().onMessage?.({
        nativeEvent: {
          data: envelope({ type: 'checkout:step', payload: { step: 'deposit' } }),
          url: CHECKOUT_URL,
        },
      });

      expect(accessibilityAnnouncements()).toContain('Deposit to escrow');
    });

    it('announces the step in the resolved locale', () => {
      renderCheckoutSheet({
        visible: true,
        checkoutUrl: CHECKOUT_URL,
        publishableKey: 'pk_test_123',
        locale: 'es',
        onRequestClose: () => {},
      });

      getWebViewHandlers().onMessage?.({
        nativeEvent: {
          data: envelope({ type: 'checkout:step', payload: { step: 'deposit' } }),
          url: CHECKOUT_URL,
        },
      });

      expect(accessibilityAnnouncements()).toContain('Depositar en garantía');
    });

    it('localizes the close button label from railRegion when no explicit locale is given', () => {
      renderCheckoutSheet({
        visible: true,
        checkoutUrl: CHECKOUT_URL,
        publishableKey: 'pk_test_123',
        railRegion: 'BR',
        onRequestClose: () => {},
      });

      expect(screen.getByLabelText('Fechar pagamento')).toBeInTheDocument();
    });

    it('applies per-string message overrides to the native chrome', () => {
      renderCheckoutSheet({
        visible: true,
        checkoutUrl: CHECKOUT_URL,
        publishableKey: 'pk_test_123',
        messages: { actions: { close: 'Dismiss' } },
        onRequestClose: () => {},
      });

      expect(screen.getByText('Dismiss')).toBeInTheDocument();
    });
  });
});
