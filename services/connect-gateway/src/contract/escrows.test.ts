import type { CheckoutSession } from '@prisma/client';
import { beforeEach, describe, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { buildClientSecret, hashClientSecret } from '../sessions.js';
import { resetSimulator } from '../testmode/simulator.js';
import { expectResponseMatchesSpec } from './assert-response.js';
import { clientSecretHeaders, mockApiKey } from './fixtures.js';

vi.mock('../keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: (origin: string, allowed: string[]) => allowed.includes(origin),
  normalizeOrigin: (raw: string) => {
    try {
      return new URL(raw).origin.toLowerCase();
    } catch {
      return null;
    }
  },
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  hashSecretKey: vi.fn(),
  generateKeyPair: vi.fn(),
}));

vi.mock('../db.js', () => ({
  prisma: {
    checkoutSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../db.js';
import * as keys from '../keys.js';

describe('contract: escrow routes', () => {
  const sessionExpiresAt = new Date('2024-06-01T12:15:00.000Z');
  let clientSecret: string;
  let mockCheckoutSession: CheckoutSession;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    process.env.TESTMODE_RELEASE_DELAY_MS = '3000';
    resetSimulator();

    clientSecret = buildClientSecret('session_1', mockApiKey.id, sessionExpiresAt);
    mockCheckoutSession = {
      id: 'session_1',
      apiKeyId: mockApiKey.id,
      mode: 'buy',
      listingId: 'listing_1',
      quote: null,
      clientSecretHash: hashClientSecret(clientSecret),
      status: 'active',
      expiresAt: sessionExpiresAt,
      refreshCount: 0,
      createdAt: new Date('2024-06-01T12:00:00.000Z'),
      updatedAt: new Date('2024-06-01T12:00:00.000Z'),
      merchantId: null,
    };

    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(prisma.checkoutSession.findUnique).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockCheckoutSession);
  });

  it('POST /v1/escrows lifecycle responses match OpenAPI schemas', async () => {
    const app = createApp();
    const headers = clientSecretHeaders(clientSecret);

    const createRes = await app.request('/v1/escrows', {
      method: 'POST',
      headers,
      body: JSON.stringify({ quoteId: 'quote_1', amount: '150', asset: 'USDC' }),
    });
    const created = await expectResponseMatchesSpec(createRes, {
      method: 'POST',
      path: '/v1/escrows',
    });
    const escrowId = (created as { escrow: { id: string } }).escrow.id;

    const getRes = await app.request(`/v1/escrows/${escrowId}`, { headers });
    await expectResponseMatchesSpec(getRes, {
      method: 'GET',
      path: '/v1/escrows/{id}',
    });

    const statusRes = await app.request(`/v1/escrows/${escrowId}/status`, { headers });
    await expectResponseMatchesSpec(statusRes, {
      method: 'GET',
      path: '/v1/escrows/{id}/status',
    });

    const depositRes = await app.request(`/v1/escrows/${escrowId}/deposit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ testMode: true }),
    });
    await expectResponseMatchesSpec(depositRes, {
      method: 'POST',
      path: '/v1/escrows/{id}/deposit',
    });

    const fiatRes = await app.request(`/v1/escrows/${escrowId}/fiat-report`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: 'SINPE', reference: 'ref-123' }),
    });
    await expectResponseMatchesSpec(fiatRes, {
      method: 'POST',
      path: '/v1/escrows/{id}/fiat-report',
    });
  });

  it('GET /v1/escrows/events returns SSE content type on success', async () => {
    const app = createApp();
    const headers = clientSecretHeaders(clientSecret);

    const createRes = await app.request('/v1/escrows', {
      method: 'POST',
      headers,
      body: JSON.stringify({ quoteId: 'quote_1' }),
    });
    const created = (await createRes.json()) as { escrow: { id: string } };

    const eventsRes = await app.request(`/v1/escrows/events?escrowId=${created.escrow.id}`, {
      headers,
      signal: AbortSignal.timeout(100),
    });

    await expectResponseMatchesSpec(eventsRes, {
      method: 'GET',
      path: '/v1/escrows/events',
    });
  });

  it('POST /v1/escrows without client secret matches ErrorEnvelope schema', async () => {
    const app = createApp();
    const res = await app.request('/v1/escrows', {
      method: 'POST',
      headers: {
        Origin: 'https://allowed.example',
        'x-pacto-publishable-key': mockApiKey.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ quoteId: 'quote_1' }),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/escrows',
      expectedStatus: 401,
    });
  });
});
