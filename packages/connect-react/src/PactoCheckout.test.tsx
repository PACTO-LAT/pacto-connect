import { createMemoryCheckoutStorage } from '@pacto-connect/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PactoCheckout } from './PactoCheckout';

const gatewayUrl = 'https://gateway.example';
const publishableKey = 'pk_test_123';
const listingId = 'lst_1';

const listing = {
  id: listingId,
  asset: 'USDC',
  amount: '100',
  price: '5000',
  side: 'buy' as const,
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const quote = {
  id: 'quo_1',
  listingId,
  asset: 'USDC',
  amount: '100',
  price: '5000',
  side: 'buy' as const,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const escrow = {
  id: 'esc_1',
  quoteId: quote.id,
  status: 'pending' as const,
  amount: '100',
  asset: 'USDC',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function encodeSse(block: string): Uint8Array {
  return new TextEncoder().encode(block);
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

function sseResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encodeSse(event));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    body: stream,
    headers: new Headers(),
  } as Response;
}

function createDeferredSseResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  return {
    response: () =>
      ({
        ok: true,
        status: 200,
        body: stream,
        headers: new Headers(),
      }) as Response,
    push: (block: string) => controller.enqueue(encodeSse(block)),
    close: () => {
      try {
        controller.close();
      } catch {
        // Stream may already be closed.
      }
    },
  };
}

function createFetchMock(sse?: ReturnType<typeof createDeferredSseResponse>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/v1/session') && method === 'POST') {
      return jsonResponse({
        sessionId: 'sess_1',
        clientSecret: 'cs_sess_1.sig',
        expiresAt: '2099-01-01T00:00:00.000Z',
        mode: 'buy',
      });
    }

    if (url.includes(`/v1/listings/${listingId}`)) {
      return jsonResponse({ listing });
    }

    if (url.endsWith('/v1/listings')) {
      return jsonResponse({ listings: [listing] });
    }

    if (url.endsWith('/v1/quotes') && method === 'POST') {
      return jsonResponse({ quote });
    }

    if (url.endsWith('/v1/escrows') && method === 'POST') {
      return jsonResponse({ escrow });
    }

    if (url.includes('/deposit') && method === 'POST') {
      return jsonResponse({ escrow: { ...escrow, status: 'funded' } });
    }

    if (url.includes('/fiat-receipt') && method === 'POST') {
      return jsonResponse({ escrow: { ...escrow, status: 'active' } });
    }

    if (url.includes('/v1/test/escrows/')) {
      return jsonResponse({ escrow: { ...escrow, status: 'released' } });
    }

    if (url.includes('/v1/escrows/events')) {
      if (sse) {
        return sse.response();
      }
      return sseResponse([]);
    }

    return jsonResponse({ error: 'not found' }, 404);
  });
}

describe('PactoCheckout', () => {
  let defaultSse: ReturnType<typeof createDeferredSseResponse>;

  beforeEach(() => {
    defaultSse = createDeferredSseResponse();
    vi.stubGlobal('fetch', createFetchMock(defaultSse));
    sessionStorage.clear();
  });

  afterEach(() => {
    defaultSse.close();
    cleanup();
    vi.unstubAllGlobals();
  });

  it('completes buy flow end-to-end and calls onComplete', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const sse = createDeferredSseResponse();

    vi.stubGlobal('fetch', createFetchMock(sse));

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        listingId={listingId}
        open
        onClose={() => {}}
        onComplete={onComplete}
        testMode
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Confirm deposit' }));

    await waitFor(() => {
      expect(screen.getByTestId('receipt-form')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Payment reference'), 'REF-123');
    await user.click(screen.getByRole('button', { name: 'Submit receipt' }));

    await waitFor(() => {
      expect(screen.getByTestId('tracking-step')).toBeInTheDocument();
    });

    sse.push(
      'id: cursor-1\nevent: released\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
    );
    sse.close();

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'esc_1' }));
    });

    expect(screen.getByTestId('checkout-success')).toBeInTheDocument();
  });

  it('calls onDispute when escrow is disputed', async () => {
    const onDispute = vi.fn();
    const user = userEvent.setup();
    const sse = createDeferredSseResponse();

    vi.stubGlobal('fetch', createFetchMock(sse));

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        listingId={listingId}
        open
        onClose={() => {}}
        onDispute={onDispute}
        testMode
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Confirm deposit' }));
    await waitFor(() => {
      expect(screen.getByTestId('receipt-form')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Payment reference'), 'REF-456');
    await user.click(screen.getByRole('button', { name: 'Submit receipt' }));

    await waitFor(() => {
      expect(screen.getByTestId('tracking-step')).toBeInTheDocument();
    });

    sse.push(
      'id: cursor-1\nevent: disputed\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
    );
    sse.close();

    await waitFor(() => {
      expect(onDispute).toHaveBeenCalledWith(expect.objectContaining({ id: 'esc_1' }));
    });

    expect(screen.getByTestId('checkout-disputed')).toBeInTheDocument();
  });

  it('calls onRefund when escrow is refunded', async () => {
    const onRefund = vi.fn();
    const user = userEvent.setup();
    const sse = createDeferredSseResponse();

    vi.stubGlobal('fetch', createFetchMock(sse));

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        listingId={listingId}
        open
        onClose={() => {}}
        onRefund={onRefund}
        testMode
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Confirm deposit' }));
    await waitFor(() => {
      expect(screen.getByTestId('receipt-form')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Payment reference'), 'REF-456');
    await user.click(screen.getByRole('button', { name: 'Submit receipt' }));

    await waitFor(() => {
      expect(screen.getByTestId('tracking-step')).toBeInTheDocument();
    });

    sse.push(
      'id: cursor-1\nevent: refunded\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
    );
    sse.close();

    await waitFor(() => {
      expect(onRefund).toHaveBeenCalledWith(expect.objectContaining({ id: 'esc_1' }));
    });

    expect(screen.getByTestId('checkout-refunded')).toBeInTheDocument();
  });

  it('shows error state when session creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid_key', message: 'Bad key' }, 401)),
    );

    const onError = vi.fn();

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        listingId={listingId}
        open
        onClose={() => {}}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkout-error')).toBeInTheDocument();
    });

    expect(onError).toHaveBeenCalled();
  });

  it('lists listings when no listingId is provided', async () => {
    const user = userEvent.setup();

    render(
      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        open
        onClose={() => {}}
        testMode
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('listing-list')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /USDC/ }));

    await waitFor(() => {
      expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('renders dialog with ARIA attributes', async () => {
      render(
        <PactoCheckout
          publishableKey="pk_live_123"
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      const dialog = await screen.findByTestId('pacto-checkout-dialog');
      expect(dialog).toHaveAttribute('role', 'dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'pacto-checkout-title');
    });

    it('closes on Escape key', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();

      render(
        <PactoCheckout
          publishableKey="pk_live_123"
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={onClose}
        />,
      );

      await screen.findByTestId('pacto-checkout-dialog');
      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    it('traps focus within the dialog on Tab', async () => {
      render(
        <PactoCheckout
          publishableKey="pk_live_123"
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      const dialog = await screen.findByTestId('pacto-checkout-dialog');
      const closeButton = screen.getByRole('button', { name: 'Close checkout' });
      const confirmButton = await screen.findByRole('button', { name: 'Confirm deposit' });

      // Reaching "deposit" is itself a step change (from the initial "loading"
      // step), so focus already moved to its heading — not the close button.
      expect(screen.getByRole('heading', { name: 'Deposit to escrow' })).toHaveFocus();

      await userEvent.tab();
      expect(closeButton).toHaveFocus();

      await userEvent.tab();
      expect(confirmButton).toHaveFocus();

      await userEvent.tab();
      expect(closeButton).toHaveFocus();
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('moves focus to the new step heading and announces it via the live region on step change', async () => {
      const user = userEvent.setup();

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          testMode
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Deposit to escrow' })).toHaveFocus();
      });
      expect(screen.getByTestId('checkout-step-announcer')).toHaveTextContent('Deposit to escrow');

      await user.click(screen.getByRole('button', { name: 'Confirm deposit' }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Upload payment receipt' })).toHaveFocus();
      });
      expect(screen.getByTestId('checkout-step-announcer')).toHaveTextContent(
        'Upload payment receipt',
      );
    });

    it('announces the detailed terminal message, including the escrow id, on success', async () => {
      const user = userEvent.setup();
      const sse = createDeferredSseResponse();
      vi.stubGlobal('fetch', createFetchMock(sse));

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          testMode
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Confirm deposit' }));
      await waitFor(() => {
        expect(screen.getByTestId('receipt-form')).toBeInTheDocument();
      });
      await user.type(screen.getByLabelText('Payment reference'), 'REF-123');
      await user.click(screen.getByRole('button', { name: 'Submit receipt' }));
      await waitFor(() => {
        expect(screen.getByTestId('tracking-step')).toBeInTheDocument();
      });

      sse.push(
        'id: cursor-1\nevent: released\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
      );
      sse.close();

      await waitFor(() => {
        expect(screen.getByTestId('checkout-step-announcer')).toHaveTextContent(
          'Payment complete. Escrow esc_1 released.',
        );
      });
    });

    it('gives every interactive control an accessible name', async () => {
      const user = userEvent.setup();

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          open
          onClose={() => {}}
          testMode
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('listing-list')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'Close checkout' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /USDC/ })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /USDC/ }));
      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Confirm deposit' }));

      await waitFor(() => {
        expect(screen.getByTestId('receipt-form')).toBeInTheDocument();
      });
      expect(screen.getByLabelText('Payment method')).toBeInTheDocument();
      expect(screen.getByLabelText('Payment reference')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit receipt' })).toBeInTheDocument();
    });

    it('warns at configuration time with a message naming the failing pair when the theme fails WCAG AA', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          theme={{ colors: { text: '#ffffff', surface: '#ffffff' } }}
        />,
      );

      await waitFor(() => {
        expect(warnSpy).toHaveBeenCalledTimes(1);
      });
      expect(warnSpy.mock.calls[0]![0]).toContain('colors.text on colors.surface');

      warnSpy.mockRestore();
    });

    it('does not warn when the theme passes WCAG AA', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('completes an entire checkout using only the keyboard', async () => {
      const onComplete = vi.fn();
      const user = userEvent.setup();
      const sse = createDeferredSseResponse();
      vi.stubGlobal('fetch', createFetchMock(sse));

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          open
          onClose={() => {}}
          onComplete={onComplete}
          testMode
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('listing-list')).toBeInTheDocument();
      });

      // Tab from the top of the dialog to the listing button, then activate it
      // with the keyboard (Enter) instead of a pointer click.
      await user.tab();
      await user.tab();
      expect(screen.getByRole('button', { name: /USDC/ })).toHaveFocus();
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });
      // Selecting the listing is a step change, so focus lands on the new
      // step's heading first — from there, Tab reaches "Confirm deposit".
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Deposit to escrow' })).toHaveFocus();
      });
      await user.tab();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Confirm deposit' })).toHaveFocus();
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByTestId('receipt-form')).toBeInTheDocument();
      });
      // uploadReceipt is another step change, so focus starts on its heading.
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Upload payment receipt' })).toHaveFocus();
      });
      await user.tab(); // close button
      await user.tab(); // payment method select
      await user.tab();
      expect(screen.getByLabelText('Payment reference')).toHaveFocus();
      await user.keyboard('REF-789');
      await user.keyboard('{Tab}');
      expect(screen.getByRole('button', { name: 'Submit receipt' })).toHaveFocus();
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByTestId('tracking-step')).toBeInTheDocument();
      });

      sse.push(
        'id: cursor-1\nevent: released\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
      );
      sse.close();

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'esc_1' }));
      });
      expect(screen.getByTestId('checkout-success')).toBeInTheDocument();
    });

    it('dismisses the widget with the keyboard alone (Escape) and returns focus to the trigger', async () => {
      const user = userEvent.setup();

      function Harness() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Open checkout
            </button>
            <PactoCheckout
              publishableKey={publishableKey}
              gatewayUrl={gatewayUrl}
              listingId={listingId}
              open={open}
              onClose={() => setOpen(false)}
            />
          </>
        );
      }

      render(<Harness />);
      const trigger = screen.getByRole('button', { name: 'Open checkout' });
      await user.click(trigger);

      await screen.findByTestId('pacto-checkout-dialog');
      await user.keyboard('{Escape}');

      expect(screen.queryByTestId('pacto-checkout-dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  describe('test mode', () => {
    it('shows TEST MODE banner for pk_test_ keys', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('checkout-test-banner')).toBeInTheDocument();
      });

      expect(screen.getByTestId('checkout-test-banner')).toHaveTextContent(
        'TEST MODE — no real funds or Stellar transactions',
      );
    });

    it('does not show TEST MODE banner for pk_live_ keys', async () => {
      render(
        <PactoCheckout
          publishableKey="pk_live_123"
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('checkout-test-banner')).not.toBeInTheDocument();
    });

    it('invokes api.test controls when simulator buttons are clicked', async () => {
      const fetchMock = createFetchMock();
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('checkout-simulator-controls')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Force release' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/v1/test/escrows/esc_1/release'),
          expect.objectContaining({ method: 'POST' }),
        );
      });

      await user.click(screen.getByRole('button', { name: 'Force dispute' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/v1/test/escrows/esc_1/dispute'),
          expect.objectContaining({ method: 'POST' }),
        );
      });

      await user.click(screen.getByRole('button', { name: 'Force timeout' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/v1/test/escrows/esc_1/timeout'),
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });
  });

  describe('white-label theming', () => {
    it('renders Spanish copy when locale="es"', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          locale="es"
          testMode
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'Confirmar depósito' })).toBeInTheDocument();
      expect(screen.getByTestId('checkout-test-banner')).toHaveTextContent(
        'MODO DE PRUEBA — sin fondos reales ni transacciones en Stellar',
      );
    });

    it('applies theme CSS variables to the overlay', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          theme={{ colors: { primary: '#e11d48' } }}
        />,
      );

      const overlay = await screen.findByTestId('pacto-checkout-overlay');
      expect(overlay.style.getPropertyValue('--pacto-color-primary')).toBe('#e11d48');
    });

    it('renders the brand logo when logoUrl is set', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          logoUrl="https://cdn.example/logo.svg"
          logoAlt="Acme"
        />,
      );

      const logo = await screen.findByAltText('Acme');
      expect(logo).toHaveAttribute('src', 'https://cdn.example/logo.svg');
      expect(logo).toHaveClass('pacto-checkout-logo');
    });

    it('renders Portuguese copy when locale="pt"', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          locale="pt"
          testMode
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'Confirmar depósito' })).toBeInTheDocument();
      expect(screen.getByTestId('checkout-test-banner')).toHaveTextContent(
        'MODO DE TESTE — sem fundos reais ou transações Stellar',
      );
    });

    it('derives the locale from the rail region when no explicit locale is given', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          railRegion="BR"
          testMode
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'Confirmar depósito' })).toBeInTheDocument();
    });

    it('prefers the explicit locale over the rail region', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          locale="en"
          railRegion="BR"
          testMode
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'Confirm deposit' })).toBeInTheDocument();
    });

    it('formats listing amounts per locale instead of printing the raw number', async () => {
      const enRender = render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          open
          onClose={() => {}}
          locale="en"
          testMode
        />,
      );

      await waitFor(() => {
        expect(enRender.getByTestId('listing-list')).toBeInTheDocument();
      });
      expect(enRender.getByRole('button', { name: /USDC/ })).toHaveTextContent('100.00');
      enRender.unmount();
      sessionStorage.clear();

      const ptRender = render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          open
          onClose={() => {}}
          locale="pt"
          testMode
        />,
      );

      await waitFor(() => {
        expect(ptRender.getByTestId('listing-list')).toBeInTheDocument();
      });
      expect(ptRender.getByRole('button', { name: /USDC/ })).toHaveTextContent('100,00');
      ptRender.unmount();
    });

    it('allows per-string message overrides', async () => {
      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          messages={{ actions: { confirmDeposit: 'Pay now' } }}
          testMode
        />,
      );

      expect(await screen.findByRole('button', { name: 'Pay now' })).toBeInTheDocument();
    });
  });

  describe('durable flow state', () => {
    it('resumes at the same step after remount when storage is shared', async () => {
      const storage = createMemoryCheckoutStorage();
      const fetchMock = createFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const { unmount } = render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          storage={storage}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });

      unmount();

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          storage={storage}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });

      const sessionPosts = fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).includes('/v1/session') && (init?.method ?? 'GET') === 'POST',
      );
      expect(sessionPosts).toHaveLength(1);
    });

    it('surfaces quote expiry instead of a live deposit after remount', async () => {
      const storage = createMemoryCheckoutStorage();
      const expiredQuote = {
        ...quote,
        expiresAt: '2024-01-01T00:00:00.000Z',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? 'GET';

          if (url.includes('/v1/session') && method === 'POST') {
            return jsonResponse({
              sessionId: 'sess_1',
              clientSecret: 'cs_sess_1.sig',
              expiresAt: '2099-01-01T00:00:00.000Z',
              mode: 'buy',
            });
          }

          if (url.includes(`/v1/listings/${listingId}`)) {
            return jsonResponse({ listing });
          }

          if (url.endsWith('/v1/quotes') && method === 'POST') {
            return jsonResponse({ quote: expiredQuote });
          }

          if (url.endsWith('/v1/escrows') && method === 'POST') {
            return jsonResponse({ escrow });
          }

          return jsonResponse({ error: 'not found' }, 404);
        }),
      );

      const { unmount } = render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          storage={storage}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('deposit-step')).toBeInTheDocument();
      });

      unmount();

      render(
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={listingId}
          open
          onClose={() => {}}
          storage={storage}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('checkout-error')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('deposit-step')).not.toBeInTheDocument();
      expect(screen.getByTestId('checkout-error')).toHaveTextContent(
        'This quote has expired. Please start checkout again.',
      );
    });
  });
});
