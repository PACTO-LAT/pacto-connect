import type { CheckoutSession, Subscription } from '@prisma/client';
import { beforeEach, describe, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { buildClientSecret, hashClientSecret } from '../sessions.js';
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
    checkoutSession: { findUnique: vi.fn(), update: vi.fn() },
    subscription: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    idempotencyRecord: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../webhooks/events.js', () => ({
  emitSubscriptionCreated: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
  emitSubscriptionCanceled: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
}));

import { prisma } from '../db.js';
import * as keys from '../keys.js';

function buildSub(overrides: Partial<Subscription> = {}): Subscription {
  const now = new Date('2026-07-18T12:00:00.000Z');
  return {
    id: 'sub_1',
    apiKeyId: 'key_1',
    sessionId: 'session_1',
    payerRef: 'cust_42',
    from: 'USD',
    to: 'CRC',
    amount: 100,
    asset: 'USDC',
    interval: 'month',
    status: 'active',
    attemptCount: 0,
    failNextCharge: false,
    nextChargeAt: now,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    merchantId: null,
    ...overrides,
  };
}

describe('contract: subscription routes', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');
  const sessionExpiresAt = new Date('2026-07-18T12:15:00.000Z');
  let clientSecret: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    process.env.TESTMODE_SUB_INTERVAL_MS = '3000';

    clientSecret = buildClientSecret('session_1', mockApiKey.id, sessionExpiresAt);
    const mockSession: CheckoutSession = {
      id: 'session_1',
      apiKeyId: mockApiKey.id,
      mode: 'buy',
      listingId: 'listing_1',
      quote: null,
      clientSecretHash: hashClientSecret(clientSecret),
      status: 'active',
      expiresAt: sessionExpiresAt,
      refreshCount: 0,
      createdAt: now,
      updatedAt: now,
      merchantId: null,
      counterpartyRef: null,
    };

    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(prisma.checkoutSession.findUnique).mockReset();
    vi.mocked(prisma.subscription.create).mockReset();
    vi.mocked(prisma.subscription.findFirst).mockReset();
    vi.mocked(prisma.subscription.findMany).mockReset();
    vi.mocked(prisma.subscription.update).mockReset();
    vi.mocked(prisma.idempotencyRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.idempotencyRecord.create).mockResolvedValue({} as never);
    vi.mocked(prisma.idempotencyRecord.update).mockResolvedValue({} as never);
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockSession);
  });

  it('POST /v1/subscriptions success matches SubscriptionResponse schema', async () => {
    vi.mocked(prisma.subscription.create).mockResolvedValue(buildSub());
    const app = createApp();

    const res = await app.request('/v1/subscriptions', {
      method: 'POST',
      headers: clientSecretHeaders(clientSecret),
      body: JSON.stringify({
        from: 'USD',
        to: 'CRC',
        amount: 100,
        interval: 'month',
        payerRef: 'cust_42',
      }),
    });

    await expectResponseMatchesSpec(res, { method: 'POST', path: '/v1/subscriptions' });
  });

  it('GET /v1/subscriptions success matches SubscriptionListResponse schema', async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([buildSub()]);
    const app = createApp();

    const res = await app.request('/v1/subscriptions', {
      headers: clientSecretHeaders(clientSecret),
    });

    await expectResponseMatchesSpec(res, { method: 'GET', path: '/v1/subscriptions' });
  });

  it('GET /v1/subscriptions/{id} success matches SubscriptionResponse schema', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(buildSub());
    const app = createApp();

    const res = await app.request('/v1/subscriptions/sub_1', {
      headers: clientSecretHeaders(clientSecret),
    });

    await expectResponseMatchesSpec(res, { method: 'GET', path: '/v1/subscriptions/{id}' });
  });

  it('POST /v1/subscriptions/{id}/cancel success matches SubscriptionResponse schema', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(buildSub());
    vi.mocked(prisma.subscription.update).mockResolvedValue(
      buildSub({ status: 'canceled', canceledAt: now }),
    );
    const app = createApp();

    const res = await app.request('/v1/subscriptions/sub_1/cancel', {
      method: 'POST',
      headers: clientSecretHeaders(clientSecret),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/subscriptions/{id}/cancel',
    });
  });

  it('POST /v1/subscriptions validation error matches ErrorEnvelope schema', async () => {
    const app = createApp();
    const res = await app.request('/v1/subscriptions', {
      method: 'POST',
      headers: clientSecretHeaders(clientSecret),
      body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100, interval: 'year' }),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/subscriptions',
      expectedStatus: 400,
    });
  });
});
