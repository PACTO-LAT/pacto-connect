import type { ApiKey, CheckoutSession, Escrow, EscrowDispute, EscrowRefund } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { IDEMPOTENCY_KEY_HEADER } from '../middleware/idempotency.js';
import { PUBLISHABLE_KEY_HEADER } from '../middleware/origin.js';
import { buildClientSecret, hashClientSecret } from '../sessions.js';
import { getSimulator, resetSimulator } from '../testmode/simulator.js';

const mockApiKey: ApiKey = {
  id: 'key_1',
  publishableKey: 'pk_test_mockkey',
  secretKeyHash: 'hash',
  secretLast4: 'abcd',
  mode: 'test',
  allowedOrigins: ['https://allowed.example'],
  status: 'active',
  label: null,
  quoteSpreadBps: 0,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  rotatedFromId: null,
  graceExpiresAt: null,
};

const liveApiKey: ApiKey = { ...mockApiKey, publishableKey: 'pk_live_mockkey', mode: 'live' };

const sessionExpiresAt = new Date('2024-06-01T12:15:00.000Z');
let clientSecret: string;
let mockCheckoutSession: CheckoutSession;

vi.mock('../keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: (origin: string, allowed: string[]) => allowed.includes(origin),
  normalizeOrigin: (raw: string) => {
    try {
      const u = new URL(raw);
      return u.origin.toLowerCase();
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
    escrow: { upsert: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    escrowRefund: { create: vi.fn() },
    escrowDispute: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    idempotencyRecord: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../webhooks/events.js', () => ({
  emitEscrowCancelled: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
  emitEscrowRefunded: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
  emitDisputeOpened: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
  emitDisputeResolved: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
}));

vi.mock('../idempotency.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../idempotency.js')>();
  return {
    ...actual,
    beginIdempotency: vi.fn(),
    completeIdempotency: vi.fn(),
  };
});

import { prisma } from '../db.js';
import { beginIdempotency, completeIdempotency } from '../idempotency.js';
import * as keys from '../keys.js';
import {
  emitDisputeOpened,
  emitDisputeResolved,
  emitEscrowCancelled,
  emitEscrowRefunded,
} from '../webhooks/events.js';

function headers(apiKey: ApiKey = mockApiKey, extra: Record<string, string> = {}) {
  return {
    Origin: 'https://allowed.example',
    [PUBLISHABLE_KEY_HEADER]: apiKey.publishableKey,
    Authorization: `Bearer ${clientSecret}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function adminHeaders(apiKey: ApiKey = mockApiKey) {
  return {
    Origin: 'https://allowed.example',
    [PUBLISHABLE_KEY_HEADER]: apiKey.publishableKey,
    Authorization: 'Bearer admin-token-123',
    'Content-Type': 'application/json',
  };
}

async function createEscrow(app: ReturnType<typeof createApp>) {
  const res = await app.request('/v1/escrows', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ quoteId: 'quote_1', amount: '100', asset: 'USDC' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { escrow: { id: string } };
  return body.escrow.id;
}

async function fundEscrow(app: ReturnType<typeof createApp>, escrowId: string) {
  const res = await app.request(`/v1/escrows/${escrowId}/deposit`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ testMode: true }),
  });
  expect(res.status).toBe(200);
}

async function releaseEscrow(app: ReturnType<typeof createApp>, escrowId: string) {
  fundEscrow(app, escrowId);
  getSimulator().forceRelease('session_1', escrowId, 'key_1');
}

describe('escrow lifecycle routes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    process.env.GATEWAY_ADMIN_TOKEN = 'admin-token-123';
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
      counterpartyRef: null,
    };

    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(prisma.checkoutSession.findUnique).mockReset();
    vi.mocked(prisma.escrow.upsert).mockReset();
    vi.mocked(prisma.escrow.update).mockReset();
    vi.mocked(prisma.escrow.findFirst).mockReset();
    vi.mocked(prisma.escrowRefund.create).mockReset();
    vi.mocked(prisma.escrowDispute.create).mockReset();
    vi.mocked(prisma.escrowDispute.findFirst).mockReset();
    vi.mocked(prisma.escrowDispute.update).mockReset();
    vi.mocked(prisma.idempotencyRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.idempotencyRecord.create).mockResolvedValue({} as never);
    vi.mocked(prisma.idempotencyRecord.update).mockResolvedValue({} as never);

    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockCheckoutSession);
    vi.mocked(prisma.escrow.upsert).mockImplementation((async (args: { create: Escrow }) => ({
      ...args.create,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as never);
    vi.mocked(prisma.escrow.update).mockImplementation((async (args: {
      where: { id: string };
      data: { status?: Escrow['status'] };
    }) => ({
      id: args.where.id,
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      status: args.data.status ?? 'cancelled',
      amount: 100,
      asset: 'USDC',
      merchantId: null,
      cancelReason: null,
      cancelledAt: null,
      cancelledBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as never);
    vi.mocked(prisma.escrowRefund.create).mockImplementation((async (args: {
      data: EscrowRefund;
    }) => ({
      ...args.data,
      createdAt: new Date(),
    })) as never);
    vi.mocked(prisma.escrowDispute.create).mockImplementation((async (args: {
      data: EscrowDispute;
    }) => ({
      ...args.data,
      status: 'open',
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as never);

    vi.mocked(emitEscrowCancelled).mockClear();
    vi.mocked(emitEscrowRefunded).mockClear();
    vi.mocked(emitDisputeOpened).mockClear();
    vi.mocked(emitDisputeResolved).mockClear();
    vi.mocked(beginIdempotency).mockReset();
    vi.mocked(completeIdempotency).mockReset();
    vi.mocked(beginIdempotency).mockResolvedValue({ kind: 'proceed' });
  });

  it('POST /v1/escrows/:id/cancel cancels a pending escrow', async () => {
    const app = createApp();
    const escrowId = await createEscrow(app);

    const res = await app.request(`/v1/escrows/${escrowId}/cancel`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ reason: 'buyer_withdrew' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { escrow: { status: string } };
    expect(body.escrow.status).toBe('cancelled');
    expect(emitEscrowCancelled).toHaveBeenCalledTimes(1);
  });

  it('POST /v1/escrows/:id/cancel rejects cancel after funding with escrow_error', async () => {
    const app = createApp();
    const escrowId = await createEscrow(app);
    await fundEscrow(app, escrowId);

    const res = await app.request(`/v1/escrows/${escrowId}/cancel`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { type: string; code: string; pactoCode: string } };
    expect(body.error.type).toBe('escrow_error');
    expect(body.error.code).toBe('invalid_transition');
    expect(body.error.pactoCode).toBe('PACTO_ESCROW');
    expect(emitEscrowCancelled).not.toHaveBeenCalled();
  });

  it('POST /v1/escrows/:id/refund issues a partial refund on released escrow', async () => {
    const app = createApp();
    const escrowId = await createEscrow(app);
    await fundEscrow(app, escrowId);
    getSimulator().forceRelease('session_1', escrowId, 'key_1');

    const res = await app.request(`/v1/escrows/${escrowId}/refund`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ amount: '40', reason: 'partial_return' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      escrow: { status: string; refundedAmount?: string; remainingAmount?: string };
      refund: { amount: number };
    };
    expect(body.escrow.status).toBe('released');
    expect(body.escrow.refundedAmount).toBe('40');
    expect(body.escrow.remainingAmount).toBe('60');
    expect(body.refund.amount).toBe('40');
    expect(emitEscrowRefunded).toHaveBeenCalledTimes(1);
  });

  it('POST /v1/escrows/:id/refund rejects refund from funded escrow', async () => {
    const app = createApp();
    const escrowId = await createEscrow(app);
    await fundEscrow(app, escrowId);

    const res = await app.request(`/v1/escrows/${escrowId}/refund`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ amount: '10', reason: 'too_early' }),
    });

    expect(res.status).toBe(409);
    expect(emitEscrowRefunded).not.toHaveBeenCalled();
  });

  it('POST /v1/escrows/:id/disputes opens a dispute and emits dispute.opened', async () => {
    const app = createApp();
    const escrowId = await createEscrow(app);
    await fundEscrow(app, escrowId);

    const res = await app.request(`/v1/escrows/${escrowId}/disputes`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ actor: 'buyer', reason: 'item_not_received' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { escrow: { status: string }; dispute: { id: string } };
    expect(body.escrow.status).toBe('disputed');
    expect(body.dispute.id).toBeTruthy();
    expect(emitDisputeOpened).toHaveBeenCalledTimes(1);
  });

  it('POST /v1/escrows/:id/disputes/:disputeId/resolve requires admin token', async () => {
    const app = createApp();
    const escrowId = await createEscrow(app);
    await fundEscrow(app, escrowId);
    const { dispute } = getSimulator().openDispute(
      'session_1',
      escrowId,
      { reason: 'test', actor: 'buyer' },
      'key_1',
    );

    vi.mocked(prisma.escrow.findFirst).mockResolvedValue({
      id: escrowId,
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      quoteId: 'quote_1',
      status: 'disputed',
      amount: 100,
      asset: 'USDC',
      merchantId: null,
      cancelReason: null,
      cancelledAt: null,
      cancelledBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.escrowDispute.findFirst).mockResolvedValue({
      id: dispute.id,
      escrowId,
      status: 'open',
      reason: 'test',
      actor: 'buyer',
      evidenceRefs: [],
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.escrowDispute.update).mockResolvedValue({
      id: dispute.id,
      escrowId,
      status: 'resolved',
      reason: 'test',
      actor: 'buyer',
      evidenceRefs: [],
      resolution: 'release',
      resolvedBy: 'admin',
      resolvedAt: new Date(),
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const unauthorized = await app.request(
      `/v1/escrows/${escrowId}/disputes/${dispute.id}/resolve`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ outcome: 'release' }),
      },
    );
    expect(unauthorized.status).toBe(401);

    const res = await app.request(`/v1/escrows/${escrowId}/disputes/${dispute.id}/resolve`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ outcome: 'release' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { escrow: { status: string } };
    expect(body.escrow.status).toBe('released');
    expect(emitDisputeResolved).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for unknown escrow', async () => {
    const app = createApp();
    const res = await app.request('/v1/escrows/esc_missing/cancel', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('returns 501 for live keys', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(liveApiKey);
    clientSecret = buildClientSecret('session_1', liveApiKey.id, sessionExpiresAt);
    mockCheckoutSession = { ...mockCheckoutSession, apiKeyId: liveApiKey.id };
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockCheckoutSession);

    const app = createApp();
    const res = await app.request('/v1/escrows/esc_1/cancel', {
      method: 'POST',
      headers: headers(liveApiKey),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(501);
  });

  it('replays idempotent cancel without re-emitting webhook', async () => {
    const app = createApp();
    const escrowId = await createEscrow(app);
    const idempotencyKey = 'idem-cancel-1';
    const replayBody = JSON.stringify({ escrow: { id: escrowId, status: 'cancelled' } });

    vi.mocked(beginIdempotency).mockResolvedValueOnce({ kind: 'proceed' }).mockResolvedValueOnce({
      kind: 'replay',
      statusCode: 200,
      responseBody: replayBody,
    });

    const first = await app.request(`/v1/escrows/${escrowId}/cancel`, {
      method: 'POST',
      headers: headers(mockApiKey, { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
      body: JSON.stringify({ reason: 'duplicate' }),
    });
    expect(first.status).toBe(200);
    expect(emitEscrowCancelled).toHaveBeenCalledTimes(1);

    const second = await app.request(`/v1/escrows/${escrowId}/cancel`, {
      method: 'POST',
      headers: headers(mockApiKey, { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
      body: JSON.stringify({ reason: 'duplicate' }),
    });
    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    expect(emitEscrowCancelled).toHaveBeenCalledTimes(1);
  });
});
