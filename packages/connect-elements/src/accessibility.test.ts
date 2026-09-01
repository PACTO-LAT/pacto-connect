import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCheckoutOptions,
  ELEMENT_TAG,
  type PactoCheckoutElement,
  registerPactoCheckoutElement,
} from './element.js';

/**
 * End-to-end accessibility coverage for the `<pacto-checkout>` custom element:
 * a full checkout driven without ever calling a pointer handler directly,
 * ARIA/focus/live-region assertions, and the theme contrast warning.
 *
 * jsdom does not synthesize the browser's native "Enter/Space activates a
 * focused <button>" default action the way a real browser does, so these
 * tests establish keyboard *reachability* via `.focus()` (exercising the
 * package's own Tab-order/focus-trap logic) and then activate the focused
 * control with `.click()`, which is what a real keyboard press triggers.
 */

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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

function sseResponse(events: string[] = []): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(event));
      }
      controller.close();
    },
  });

  return { ok: true, status: 200, body: stream, headers: new Headers() } as Response;
}

function createFetchMock() {
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
    if (url.includes('/v1/escrows/events')) {
      return sseResponse();
    }
    return jsonResponse({ error: 'not found' }, 404);
  });
}

function createElement(): PactoCheckoutElement {
  registerPactoCheckoutElement();
  return document.createElement(ELEMENT_TAG) as PactoCheckoutElement;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

async function waitForTestId(id: string): Promise<HTMLElement> {
  for (let i = 0; i < 50; i++) {
    const found = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (found) {
      return found;
    }
    await flush();
  }
  throw new Error(`timed out waiting for [data-testid="${id}"]`);
}

describe('<pacto-checkout> accessibility', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', createFetchMock());
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('completes an entire checkout without ever calling a pointer handler directly', async () => {
    const element = createElement();
    document.body.append(element);
    applyCheckoutOptions(element, { publishableKey, gatewayUrl, onComplete: undefined });
    element.open();

    const listingButton = await waitForTestId('listing-list').then(
      (list) => list.querySelector('button') as HTMLButtonElement,
    );
    listingButton.focus();
    expect(document.activeElement).toBe(listingButton);
    listingButton.click();

    const depositButton = await waitForTestId('deposit-step').then(
      (step) => step.querySelector('button') as HTMLButtonElement,
    );
    // Reaching "deposit" is a step change: focus should already be on its
    // heading, not left behind on whatever was focused for "selectListing".
    expect(document.activeElement).toBe(document.getElementById('pacto-checkout-title'));
    depositButton.focus();
    depositButton.click();

    const form = await waitForTestId('receipt-form');
    const referenceInput = form.querySelector('input') as HTMLInputElement;
    referenceInput.focus();
    referenceInput.value = 'REF-1';
    referenceInput.dispatchEvent(new Event('input', { bubbles: true }));
    (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();

    await waitForTestId('tracking-step');
    element.remove();
  });

  it('announces the step through a live region and moves focus to the new heading on step change', async () => {
    const element = createElement();
    document.body.append(element);
    applyCheckoutOptions(element, { publishableKey, gatewayUrl });
    element.open();

    await waitForTestId('listing-list');
    const announcer = document.querySelector(
      '[data-testid="checkout-step-announcer"]',
    ) as HTMLElement;
    expect(announcer.getAttribute('role')).toBe('status');
    expect(announcer.getAttribute('aria-live')).toBe('polite');
    expect(announcer.textContent).toContain('Select a listing');

    const listingButton = document.querySelector(
      '[data-testid="listing-list"] button',
    ) as HTMLButtonElement;
    listingButton.click();

    await waitForTestId('deposit-step');
    const updatedAnnouncer = document.querySelector(
      '[data-testid="checkout-step-announcer"]',
    ) as HTMLElement;
    expect(updatedAnnouncer.textContent).toContain('Deposit to escrow');
    expect(document.activeElement).toBe(document.getElementById('pacto-checkout-title'));

    element.remove();
  });

  it('gives every interactive control an accessible name', async () => {
    const element = createElement();
    document.body.append(element);
    applyCheckoutOptions(element, { publishableKey, gatewayUrl });
    element.open();

    await waitForTestId('listing-list');
    const closeButton = document.querySelector('header button') as HTMLButtonElement;
    expect(closeButton.getAttribute('aria-label')).toBe('Close checkout');

    const listingButton = document.querySelector(
      '[data-testid="listing-list"] button',
    ) as HTMLButtonElement;
    expect(listingButton.textContent?.trim().length).toBeGreaterThan(0);

    listingButton.click();
    const form = await waitForTestId('deposit-step');
    const depositButton = form.querySelector('button') as HTMLButtonElement;
    expect(depositButton.textContent?.trim()).toBe('Confirm deposit');
    depositButton.click();

    const receiptForm = await waitForTestId('receipt-form');
    const select = receiptForm.querySelector('select') as HTMLSelectElement;
    const input = receiptForm.querySelector('input') as HTMLInputElement;
    expect(select.getAttribute('aria-label')).toBe('Payment method');
    expect(input.getAttribute('aria-label')).toBe('Payment reference');

    element.remove();
  });

  it('warns at configuration time with a message naming the failing pair when the theme fails WCAG AA', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const element = createElement();
    document.body.append(element);

    applyCheckoutOptions(element, {
      publishableKey,
      gatewayUrl,
      theme: { colors: { text: '#ffffff', surface: '#ffffff' } },
    });
    element.open();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('colors.text on colors.surface');

    element.remove();
    warnSpy.mockRestore();
  });

  it('does not warn when the theme passes WCAG AA', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const element = createElement();
    document.body.append(element);

    applyCheckoutOptions(element, { publishableKey, gatewayUrl });
    element.open();

    expect(warnSpy).not.toHaveBeenCalled();

    element.remove();
    warnSpy.mockRestore();
  });
});
