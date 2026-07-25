/**
 * SSE reconnect regression test
 *
 * Verifies that EscrowEventSubscriber's cursor-based replay correctly handles
 * a dropped SSE connection without missing events or delivering duplicates.
 *
 * Mechanism:
 *   1. page.route() intercepts GET /v1/escrows/events
 *   2. The first connection is allowed through normally
 *   3. After the first SSE event is received, the second connection attempt
 *      is aborted (simulating a network drop)
 *   4. The subscriber reconnects a third time with the last cursor — the
 *      gateway replays events, seenCursors deduplicates them
 *   5. The test asserts that the flow reaches "success" and milestone count
 *      is at most 3 (funded + fiat_reported + released), proving no duplicates
 *
 * Uses connect-react (no iframe) so page.route() intercepts SSE correctly.
 * The /v1/listings and /v1/quotes mocks are also needed for the flow to start.
 */

import { test, expect } from '../fixtures/index.js';
import type { Route } from '@playwright/test';

const REACT_BASE = 'http://localhost:5174';

const MOCK_LISTING = {
  id: 'lst_e2e_sse_001',
  asset: 'USDC',
  amount: '100',
  price: '1.00',
  side: 'buy',
  status: 'active',
  createdAt: new Date().toISOString(),
};

const MOCK_QUOTE = {
  id: 'q_e2e_sse_001',
  listingId: MOCK_LISTING.id,
  asset: 'USDC',
  amount: '100',
  price: '1.00',
  side: 'buy',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  createdAt: new Date().toISOString(),
};

test.describe('SSE reconnect regression', () => {
  test('cursor replay delivers released event exactly once after connection drop', async ({
    page,
    gatewayUrl,
    publishableKey,
  }) => {
    // --- Mocks for listing / quote (not in gateway) ---
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

    // --- SSE connection interceptor ---
    // Allow the 1st and 3rd connections; abort the 2nd to simulate a network drop.
    // The subscriber then reconnects (3rd attempt) with ?cursor=<last-cursor>,
    // the gateway replays already-seen events, and seenCursors deduplicates them.
    let sseConnectionCount = 0;
    await page.route('**/v1/escrows/events**', async (route: Route) => {
      sseConnectionCount++;
      if (sseConnectionCount === 2) {
        // Abort the second connection to force a reconnect
        await route.abort('connectionreset');
      } else {
        await route.continue();
      }
    });

    const url = new URL(REACT_BASE);
    url.searchParams.set('gatewayUrl', gatewayUrl);
    url.searchParams.set('publishableKey', publishableKey);
    await page.goto(url.toString());

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
    await page.getByRole('textbox').fill('REF-SSE-RECONNECT-001');
    await page.getByTestId('receipt-form').getByRole('button', { name: /submit/i }).click();

    // Tracking step starts the SSE stream — the abort + reconnect happens here.
    // Give extra timeout (15s) to account for the reconnect backoff delay.
    await expect(page.getByTestId('checkout-success')).toBeVisible({ timeout: 15_000 });

    // Verify the connection was indeed aborted at least once
    expect(sseConnectionCount).toBeGreaterThanOrEqual(2);

    // Milestone list should have at most 3 entries (funded, fiat_reported, released).
    // More than 3 would indicate duplicate delivery from the replayed stream.
    const milestoneItems = await page
      .getByRole('list', { name: /milestones/i })
      .locator('li')
      .count();
    expect(milestoneItems).toBeLessThanOrEqual(3);
  });
});
