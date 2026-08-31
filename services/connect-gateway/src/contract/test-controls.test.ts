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
    checkoutSession: { findUnique: vi.fn(), update: vi.fn() },
    subscription: { findFirst: vi.fn(), update: vi.fn() },
    escrow: { upsert: vi.fn(), update: vi.fn() },
    escrowDispute: { create: vi.fn() },
  },
}));

vi.mock('../webhooks/events.js', () => ({
  emitDisputeOpened: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
}));

vi.mock('../subscriptions/charge.js', () => ({
  chargeSubscription: vi.fn(),
}));

import type { Escrow, EscrowDispute } from '@prisma/client';
import { prisma } from '../db.js';
import * as keys from '../keys.js';
import { chargeSubscription } from '../subscriptions/charge.js';

async function createFundedEscrow(app: ReturnType<typeof createApp>, clientSecret: string) {
  const headers = clientSecretHeaders(clientSecret);
  const createRes = await app.request('/v1/escrows', {
    method: 'POST',
    headers,
    body: JSON.stringify({ quoteId: 'quote_1' }),
  });
  const { escrow } = (await createRes.json()) as { escrow: { id: string } };

  await app.request(`/v1/escrows/${escrow.id}/deposit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });

  return escrow.id;
}

describe('contract: test control routes', () => {
  const sessionExpiresAt = new Date('2024-06-01T12:15:00.000Z');
  let clientSecret: string;
  let mockCheckoutSession: CheckoutSession;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
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
      counterpartyRef: null,
    };

    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(prisma.checkoutSession.findUnique).mockReset();
    vi.mocked(prisma.escrow.upsert).mockReset();
    vi.mocked(prisma.escrow.update).mockReset();
    vi.mocked(prisma.escrowDispute.create).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockCheckoutSession);
    vi.mocked(prisma.escrow.upsert).mockImplementation(
      (async (args: { create: Escrow }) => args.create) as never,
    );
    vi.mocked(prisma.escrow.update).mockImplementation(
      (async (args: { data: Record<string, unknown> }) => args.data) as never,
    );
    vi.mocked(prisma.escrowDispute.create).mockImplementation(
      (async (args: { data: EscrowDispute }) =>
        ({
          ...args.data,
          status: 'open',
          resolution: null,
          resolvedBy: null,
          resolvedAt: null,
          resolutionNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as EscrowDispute) as never,
    );
  });

  it('POST /v1/test/escrows/{id}/dispute matches EscrowResponse schema', async () => {
    const app = createApp();
    const escrowId = await createFundedEscrow(app, clientSecret);

    const res = await app.request(`/v1/test/escrows/${escrowId}/dispute`, {
      method: 'POST',
      headers: clientSecretHeaders(clientSecret),
      body: JSON.stringify({ reason: 'manual_review' }),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/test/escrows/{id}/dispute',
    });
  });

  it('POST /v1/test/escrows/{id}/timeout matches EscrowResponse schema', async () => {
    const app = createApp();
    const escrowId = await createFundedEscrow(app, clientSecret);

    const res = await app.request(`/v1/test/escrows/${escrowId}/timeout`, {
      method: 'POST',
      headers: clientSecretHeaders(clientSecret),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/test/escrows/{id}/timeout',
    });
  });

  it('POST /v1/test/escrows/{id}/release matches EscrowResponse schema', async () => {
    const app = createApp();
    const escrowId = await createFundedEscrow(app, clientSecret);

    const res = await app.request(`/v1/test/escrows/${escrowId}/release`, {
      method: 'POST',
      headers: clientSecretHeaders(clientSecret),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/test/escrows/{id}/release',
    });
  });

  it('POST /v1/test/subscriptions/{id}/advance matches ChargeResultResponse schema', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub_1',
      apiKeyId: 'key_1',
      sessionId: 'session_1',
    } as never);
    vi.mocked(chargeSubscription).mockResolvedValue({
      subscriptionId: 'sub_1',
      status: 'succeeded',
      escrowId: 'esc_1',
      subscriptionStatus: 'active',
    });

    const app = createApp();
    const res = await app.request('/v1/test/subscriptions/sub_1/advance', {
      method: 'POST',
      headers: clientSecretHeaders(clientSecret),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/test/subscriptions/{id}/advance',
    });
  });

  it('POST /v1/test/subscriptions/{id}/fail-next matches OkResponse schema', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub_1',
      apiKeyId: 'key_1',
      sessionId: 'session_1',
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      id: 'sub_1',
      failNextCharge: true,
    } as never);

    const app = createApp();
    const res = await app.request('/v1/test/subscriptions/sub_1/fail-next', {
      method: 'POST',
      headers: clientSecretHeaders(clientSecret),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/test/subscriptions/{id}/fail-next',
    });
  });
});
