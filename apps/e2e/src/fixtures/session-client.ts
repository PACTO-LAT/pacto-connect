import { Pacto, type PactoApiClient, type PactoSession } from '@pacto-connect/core';
import { test as webhookTest } from './webhook-capture.js';

export interface CreatedSession {
  session: PactoSession;
  api: PactoApiClient;
}

export interface SessionClientFixture {
  /**
   * Creates a checkout session using the test API key. The returned session
   * and API client are ready to use against the sandbox gateway.
   *
   * Uses the synthetic origin http://localhost:5176, which is whitelisted in
   * the test API key created by globalSetup.
   */
  createSession(mode?: 'buy' | 'sell'): Promise<CreatedSession>;
}

export const test = webhookTest.extend<{ sessionClient: SessionClientFixture }>({
  sessionClient: async ({ gatewayUrl, publishableKey }, use) => {
    const sessions: PactoSession[] = [];

    const fixture: SessionClientFixture = {
      async createSession(mode = 'buy'): Promise<CreatedSession> {
        const client = Pacto.init({
          publishableKey,
          gatewayUrl,
          // Synthetic origin whitelisted in the test key's allowedOrigins
          origin: 'http://localhost:5176',
        });

        // Use browse mode so we don't need a listingId.
        // The CheckoutFlowController would call GET /v1/listings (not in gateway),
        // so we use client.createCheckoutSession directly instead of the controller.
        const session = await client.createCheckoutSession({ quote: { browse: true }, mode });
        sessions.push(session);

        return { session, api: client.api(session) };
      },
    };

    await use(fixture);

    // Cleanup: close all SSE event streams
    for (const s of sessions) {
      s.closeEvents();
    }
  },
});
