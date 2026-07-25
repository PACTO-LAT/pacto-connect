/**
 * connect-elements E2E — <pacto-checkout> web component happy path
 *
 * The web component uses CheckoutFlowController internally, so the same
 * /v1/listings and /v1/quotes mocks as the React tests are required.
 *
 * Key difference from connect-react:
 *   - UI is rendered directly in the page DOM by CheckoutView (no iframe)
 *   - page.getByTestId() works directly
 *   - The bridge postMessage (checkout:complete) goes to window.parent which
 *     is the same window — captured by the message listener in index.html
 */

import { test, expect } from '../fixtures/index.js';
import type { Route } from '@playwright/test';

const ELEMENTS_BASE = 'http://localhost:5175';

const MOCK_LISTING = {
  id: 'lst_e2e_elem_001',
  asset: 'USDC',
  amount: '100',
  price: '1.00',
  side: 'buy',
  status: 'active',
  createdAt: new Date().toISOString(),
};

const MOCK_QUOTE = {
  id: 'q_e2e_elem_001',
  listingId: MOCK_LISTING.id,
  asset: 'USDC',
  amount: '100',
  price: '1.00',
  side: 'buy',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  createdAt: new Date().toISOString(),
};

async function mockListingsAndQuotes(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/v1/listings', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ listings: [MOCK_LISTING] }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/v1/listings/*', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ listing: MOCK_LISTING }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/v1/quotes', async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ quote: MOCK_QUOTE }),
      });
    } else {
      await route.continue();
    }
  });
}

function buildUrl(gatewayUrl: string, publishableKey: string): string {
  const url = new URL(ELEMENTS_BASE);
  url.searchParams.set('gatewayUrl', gatewayUrl);
  url.searchParams.set('publishableKey', publishableKey);
  return url.toString();
}

test.describe('connect-elements: <pacto-checkout> web component', () => {
  test('full flow: listing → deposit → fiat → released → success', async ({
    page,
    gatewayUrl,
    publishableKey,
  }) => {
    await mockListingsAndQuotes(page);
    await page.goto(buildUrl(gatewayUrl, publishableKey));

    // Web component renders directly in the page DOM (no iframe)
    await expect(page.getByTestId('checkout-test-banner')).toBeVisible({ timeout: 10_000 });

    const depositStep = page.getByTestId('deposit-step');
    const listingList = page.getByTestId('listing-list');

    await Promise.race([
      depositStep.waitFor({ state: 'visible', timeout: 10_000 }),
      listingList.waitFor({ state: 'visible', timeout: 10_000 }),
    ]);

    if (await listingList.isVisible()) {
      await listingList.getByRole('button').first().click();
    }

    await expect(depositStep).toBeVisible({ timeout: 8_000 });
    await depositStep.getByRole('button').click();

    await expect(page.getByTestId('receipt-form')).toBeVisible({ timeout: 8_000 });
    await page.getByRole('textbox').fill('REF-ELEM-E2E-001');
    await page.getByTestId('receipt-form').getByRole('button', { name: /submit/i }).click();

    await expect(page.getByTestId('tracking-step')).toBeVisible({ timeout: 8_000 });

    // Auto-release via SSE after TESTMODE_RELEASE_DELAY_MS (500ms)
    await expect(page.getByTestId('checkout-success')).toBeVisible({ timeout: 8_000 });
  });

  test('bridge: checkout:complete is postMessaged to window after success', async ({
    page,
    gatewayUrl,
    publishableKey,
  }) => {
    await mockListingsAndQuotes(page);
    await page.goto(buildUrl(gatewayUrl, publishableKey));

    await expect(page.getByTestId('checkout-test-banner')).toBeVisible({ timeout: 10_000 });

    const depositStep = page.getByTestId('deposit-step');
    const listingList = page.getByTestId('listing-list');
    await Promise.race([
      depositStep.waitFor({ state: 'visible', timeout: 10_000 }),
      listingList.waitFor({ state: 'visible', timeout: 10_000 }),
    ]);
    if (await listingList.isVisible()) {
      await listingList.getByRole('button').first().click();
    }

    await expect(depositStep).toBeVisible({ timeout: 8_000 });
    await depositStep.getByRole('button').click();

    await expect(page.getByTestId('receipt-form')).toBeVisible({ timeout: 8_000 });
    await page.getByRole('textbox').fill('REF-ELEM-E2E-002');
    await page.getByTestId('receipt-form').getByRole('button', { name: /submit/i }).click();

    await expect(page.getByTestId('checkout-success')).toBeVisible({ timeout: 8_000 });

    // Verify bridge message was captured by the message listener in index.html
    const bridgeMsg = await page.evaluate(
      () => (window as Window & { __lastBridgeMessage?: { type: string } }).__lastBridgeMessage,
    );
    expect(bridgeMsg?.type).toBe('checkout:complete');
  });
});
