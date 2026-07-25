/**
 * connect-react E2E — <PactoCheckout> component happy path & dispute
 *
 * The checkout flow controller calls GET /v1/listings and POST /v1/quotes,
 * which are not yet implemented in the gateway. We mock these via page.route()
 * so the real gateway handles everything else: session creation, escrow
 * lifecycle, and SSE events (the parts the sandbox simulator provides).
 *
 * UI data-testids are confirmed from PactoCheckout.tsx source:
 *   checkout-test-banner, deposit-step, receipt-form, tracking-step,
 *   checkout-success, checkout-disputed, checkout-simulator-controls
 */

import { test, expect } from '../fixtures/index.js';
import type { Route } from '@playwright/test';

const REACT_BASE = 'http://localhost:5174';

// A fake listing returned by the mocked GET /v1/listings
const MOCK_LISTING = {
  id: 'lst_e2e_test_001',
  asset: 'USDC',
  amount: '100',
  price: '1.00',
  side: 'buy',
  status: 'active',
  createdAt: new Date().toISOString(),
};

// A fake quote returned by the mocked POST /v1/quotes
const MOCK_QUOTE = {
  id: 'q_e2e_test_001',
  listingId: MOCK_LISTING.id,
  asset: 'USDC',
  amount: '100',
  price: '1.00',
  side: 'buy',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  createdAt: new Date().toISOString(),
};

/**
 * Installs page.route() mocks for the two endpoints the controller calls
 * that are not yet implemented in the gateway.
 */
async function mockListingsAndQuotes(page: import('@playwright/test').Page): Promise<void> {
  // GET /v1/listings → return one test listing
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

  // GET /v1/listings/:id → return the same listing
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

  // POST /v1/quotes → return the mock quote (quoteId is then passed to real /v1/escrows)
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
  const url = new URL(REACT_BASE);
  url.searchParams.set('gatewayUrl', gatewayUrl);
  url.searchParams.set('publishableKey', publishableKey);
  return url.toString();
}

test.describe('connect-react: <PactoCheckout> happy path', () => {
  test('full flow: listing → deposit → fiat → SSE released → success', async ({
    page,
    gatewayUrl,
    publishableKey,
  }) => {
    await mockListingsAndQuotes(page);
    await page.goto(buildUrl(gatewayUrl, publishableKey));

    // Test mode banner confirms the gateway returned testMode: true
    await expect(page.getByTestId('checkout-test-banner')).toBeVisible({ timeout: 10_000 });

    // After mocked listing list loads, controller auto-selects the only listing
    // OR shows selectListing step with one item. Either way deposit-step appears next.
    // If selectListing step appears, click the listing button.
    const depositStep = page.getByTestId('deposit-step');
    const listingList = page.getByTestId('listing-list');

    // Wait for one of them to appear
    await Promise.race([
      depositStep.waitFor({ state: 'visible', timeout: 10_000 }),
      listingList.waitFor({ state: 'visible', timeout: 10_000 }),
    ]);

    if (await listingList.isVisible()) {
      // Select the first listing to proceed
      await listingList.getByRole('button').first().click();
    }

    // Deposit step — uses real gateway escrow creation (q_e2e_test_001 as quoteId)
    await expect(depositStep).toBeVisible({ timeout: 8_000 });
    await depositStep.getByRole('button').click();

    // Receipt form appears after deposit
    await expect(page.getByTestId('receipt-form')).toBeVisible({ timeout: 8_000 });

    // Fill in the fiat reference
    await page.getByRole('textbox').fill('REF-REACT-E2E-001');
    await page.getByTestId('receipt-form').getByRole('button', { name: /submit/i }).click();

    // Tracking step — SSE stream is now active
    await expect(page.getByTestId('tracking-step')).toBeVisible({ timeout: 8_000 });

    // Auto-release fires after 500ms (TESTMODE_RELEASE_DELAY_MS) → success step
    await expect(page.getByTestId('checkout-success')).toBeVisible({ timeout: 8_000 });

    // Verify the JS-level onComplete callback fired
    const completed = await page.evaluate(() => !!(window as Window & { __lastCompletedEscrow?: unknown }).__lastCompletedEscrow);
    expect(completed).toBe(true);
  });

  test('dispute path: simulator controls → disputed step', async ({
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
    await page.getByRole('textbox').fill('REF-REACT-E2E-002');
    await page.getByTestId('receipt-form').getByRole('button', { name: /submit/i }).click();

    // Simulator controls appear during tracking step
    await expect(page.getByTestId('checkout-simulator-controls')).toBeVisible({ timeout: 8_000 });

    // Click force dispute (uses the real gateway test control API)
    const controls = page.getByTestId('checkout-simulator-controls');
    await controls.getByRole('button').nth(1).click(); // second button = force dispute

    await expect(page.getByTestId('checkout-disputed')).toBeVisible({ timeout: 5_000 });
  });
});
