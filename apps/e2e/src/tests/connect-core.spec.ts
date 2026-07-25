/**
 * connect-core E2E — headless happy path
 *
 * Tests the full checkout flow using the SDK directly (no browser UI):
 *   handshake (POST /v1/session)
 *   → escrow creation (POST /v1/escrows — quoteId is any string in test mode)
 *   → deposit (POST /v1/escrows/:id/deposit)
 *   → fiat report (POST /v1/escrows/:id/fiat-receipt)
 *   → SSE released event (GET /v1/escrows/events)
 *
 * Note: /v1/listings and /v1/quotes are not yet implemented in the gateway.
 * We bypass CheckoutFlowController and call the SDK primitives directly,
 * which is the correct approach for the headless surface test.
 */

import { test, expect } from '../fixtures/index.js';

test.describe('connect-core: headless happy path', () => {
  test('handshake creates a valid session', async ({ sessionClient }) => {
    const { session } = await sessionClient.createSession('buy');

    expect(session.sessionId).toMatch(/^ses_/);
    expect(session.clientSecret).toBeTruthy();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(session.mode).toBe('buy');
    expect(session.isExpired()).toBe(false);
  });

  test('full flow: session → escrow → deposit → fiat → SSE released', async ({
    sessionClient,
  }) => {
    const { session, api } = await sessionClient.createSession('buy');

    // 1. Create escrow directly (gateway accepts any quoteId string in test mode)
    const { escrow } = await api.escrows.create({ quoteId: 'test-quote-e2e-core-001' });
    expect(escrow.id).toMatch(/^esc_/);
    expect(escrow.status).toBe('pending');
    expect(escrow.asset).toBe('USDC');
    expect(escrow.amount).toBe('100');

    // 2. Simulate deposit
    const { escrow: funded } = await api.escrows.deposit(escrow.id, { testMode: true });
    expect(funded.status).toBe('funded');

    // 3. Subscribe to SSE BEFORE reporting fiat so we don't miss the released event
    const releasedPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout: released event not received')), 8_000);
      session.on(
        'released',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { escrowId: escrow.id },
      );
    });

    // 4. Report fiat — triggers auto-release after TESTMODE_RELEASE_DELAY_MS (500ms)
    const { escrow: reported } = await api.escrows.reportFiatPayment(escrow.id, {
      method: 'SINPE',
      reference: 'REF-CORE-E2E-001',
    });
    expect(reported.status).toBe('funded'); // still funded; SSE brings the released event

    // 5. Wait for the SSE released event
    await releasedPromise;
  });

  test('SSE milestones arrive in order: funded → fiat.reported → released', async ({
    sessionClient,
  }) => {
    const { session, api } = await sessionClient.createSession('buy');
    const { escrow } = await api.escrows.create({ quoteId: 'test-quote-e2e-core-002' });

    const milestones: string[] = [];

    const donePromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout. Milestones so far: ${milestones.join(', ')}`)),
        8_000,
      );

      session.on('escrow.funded', () => milestones.push('escrow.funded'), { escrowId: escrow.id });
      session.on('fiat.reported', () => milestones.push('fiat.reported'), { escrowId: escrow.id });
      session.on(
        'released',
        () => {
          milestones.push('released');
          clearTimeout(timer);
          resolve();
        },
        { escrowId: escrow.id },
      );
    });

    await api.escrows.deposit(escrow.id, { testMode: true });
    await api.escrows.reportFiatPayment(escrow.id, { method: 'SINPE', reference: 'REF-CORE-E2E-002' });
    await donePromise;

    expect(milestones).toEqual(['escrow.funded', 'fiat.reported', 'released']);
  });

  test('force dispute via test control API', async ({ sessionClient }) => {
    const { session, api } = await sessionClient.createSession('buy');
    const { escrow } = await api.escrows.create({ quoteId: 'test-quote-e2e-core-003' });
    await api.escrows.deposit(escrow.id, { testMode: true });

    const disputedPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout: disputed event')), 5_000);
      session.on(
        'disputed',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { escrowId: escrow.id },
      );
    });

    await api.test.forceDispute(escrow.id, { reason: 'e2e-test-dispute' });
    await disputedPromise;
  });

  test('force timeout via test control API', async ({ sessionClient }) => {
    const { session, api } = await sessionClient.createSession('buy');
    const { escrow } = await api.escrows.create({ quoteId: 'test-quote-e2e-core-004' });
    await api.escrows.deposit(escrow.id, { testMode: true });

    const disputedPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout: disputed event')), 5_000);
      session.on(
        'disputed',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { escrowId: escrow.id },
      );
    });

    await api.test.forceTimeout(escrow.id);
    await disputedPromise;
  });
});
