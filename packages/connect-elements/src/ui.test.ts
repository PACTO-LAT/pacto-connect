import { CheckoutFlowController, resolveMessages } from '@pacto-connect/core';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutView } from './ui';

function controllerInStep() {
  // Minimal fake controller stuck on the deposit step with an escrow.
  const escrow = { id: 'esc_1', amount: '100', asset: 'USDC' };
  return {
    getState: () => ({
      step: 'deposit',
      testMode: false,
      escrow,
      listings: [],
      milestones: [],
      error: null,
      sessionId: 'sess_1',
    }),
  } as unknown as CheckoutFlowController;
}

function controllerWithListings(
  listings: { id: string; asset: string; amount: string; price: string }[],
) {
  return {
    getState: () => ({
      step: 'selectListing',
      testMode: false,
      escrow: null,
      listings,
      milestones: [],
      error: null,
      sessionId: 'sess_1',
    }),
    selectListing: vi.fn(),
  } as unknown as CheckoutFlowController;
}

function controllerInTracking() {
  return {
    getState: () => ({
      step: 'tracking',
      testMode: false,
      escrow: { id: 'esc_1', amount: '100', asset: 'USDC' },
      listings: [],
      milestones: [{ cursor: 'c1', type: 'escrow.funded', occurredAt: '2024-01-01T00:00:00.000Z' }],
      error: null,
      sessionId: 'sess_1',
    }),
  } as unknown as CheckoutFlowController;
}

describe('CheckoutView theming and i18n', () => {
  it('renders Spanish copy when given the es dictionary', () => {
    const container = document.createElement('div');
    const view = new CheckoutView(container, controllerInStep(), {
      onClose: vi.fn(),
      messages: resolveMessages('es'),
      locale: 'es',
    });
    view.render();
    expect(container.querySelector('h2')?.textContent).toBe('Depositar en garantía');
    expect(container.textContent).toContain('Deposita 100 USDC al contrato de garantía.');
    view.destroy();
  });

  it('applies theme CSS variables to the overlay container', () => {
    const container = document.createElement('div');
    const view = new CheckoutView(container, controllerInStep(), {
      onClose: vi.fn(),
      messages: resolveMessages('en'),
      locale: 'en',
      theme: { colors: { primary: '#e11d48' } },
    });
    view.render();
    expect(container.style.getPropertyValue('--pacto-color-primary')).toBe('#e11d48');
    view.destroy();
  });

  it('renders the brand logo in the header when logoUrl is set', () => {
    const container = document.createElement('div');
    const view = new CheckoutView(container, controllerInStep(), {
      onClose: vi.fn(),
      messages: resolveMessages('en'),
      locale: 'en',
      logoUrl: 'https://cdn.example/logo.svg',
      logoAlt: 'Acme',
    });
    view.render();
    const logo = container.querySelector('img.pacto-checkout-logo') as HTMLImageElement | null;
    expect(logo).not.toBeNull();
    expect(logo?.src).toBe('https://cdn.example/logo.svg');
    expect(logo?.alt).toBe('Acme');
    view.destroy();
  });

  it('renders Portuguese copy when given the pt dictionary', () => {
    const container = document.createElement('div');
    const view = new CheckoutView(container, controllerInStep(), {
      onClose: vi.fn(),
      messages: resolveMessages('pt'),
      locale: 'pt',
    });
    view.render();
    expect(container.querySelector('h2')?.textContent).toBe('Depositar em garantia');
    view.destroy();
  });

  it('formats listing amounts per locale instead of printing the raw number', () => {
    // asset is a crypto ticker, not an ISO-4217 code — Intl currency formatting would throw on it.
    const listings = [{ id: 'lst_1', asset: 'USDC', amount: '1234.5', price: '1' }];

    const enContainer = document.createElement('div');
    new CheckoutView(enContainer, controllerWithListings(listings), {
      onClose: vi.fn(),
      messages: resolveMessages('en'),
      locale: 'en',
    }).render();

    const ptContainer = document.createElement('div');
    new CheckoutView(ptContainer, controllerWithListings(listings), {
      onClose: vi.fn(),
      messages: resolveMessages('pt'),
      locale: 'pt',
    }).render();

    const enText =
      enContainer.querySelector('[data-testid="listing-list"] button')?.textContent ?? '';
    const ptText =
      ptContainer.querySelector('[data-testid="listing-list"] button')?.textContent ?? '';

    expect(enText).toContain('1,234.50');
    expect(ptText).toContain('1.234,50');
    expect(enText).not.toBe(ptText);
  });

  it('resolves the milestone label through the catalogue, not a raw event type', () => {
    const container = document.createElement('div');
    new CheckoutView(container, controllerInTracking(), {
      onClose: vi.fn(),
      messages: resolveMessages('es'),
      locale: 'es',
    }).render();

    expect(container.textContent).toContain('Garantía fondeada');
    expect(container.textContent).not.toContain('escrow.funded');
  });
});
