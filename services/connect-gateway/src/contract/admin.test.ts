import { beforeEach, describe, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { expectResponseMatchesSpec } from './assert-response.js';
import { adminHeaders } from './fixtures.js';

const { WebhookValidationError } = vi.hoisted(() => {
  class WebhookValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'WebhookValidationError';
    }
  }

  return { WebhookValidationError };
});

vi.mock('../webhooks/endpoints.js', () => ({
  registerEndpoint: vi.fn(),
  listEndpoints: vi.fn(),
  getEndpoint: vi.fn(),
  setEndpointStatus: vi.fn(),
  deleteEndpoint: vi.fn(),
  verifyEndpoint: vi.fn(),
  WebhookValidationError,
}));

vi.mock('../webhooks/delivery.js', () => ({
  listDeliveries: vi.fn(),
  listDeadLetterDeliveries: vi.fn(),
  requeueDelivery: vi.fn(),
}));

vi.mock('../db.js', () => ({
  prisma: {},
}));

vi.mock('../merchants.js', () => ({
  findActiveMerchant: vi.fn(),
}));

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
  cutoverApiKey: vi.fn(),
}));

import * as keys from '../keys.js';
import * as delivery from '../webhooks/delivery.js';
import * as endpoints from '../webhooks/endpoints.js';

describe('contract: admin routes', () => {
  beforeEach(() => {
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
    vi.mocked(keys.listApiKeys).mockReset();
    vi.mocked(keys.createApiKey).mockReset();
    vi.mocked(endpoints.registerEndpoint).mockReset();
    vi.mocked(endpoints.verifyEndpoint).mockReset();
    vi.mocked(delivery.listDeadLetterDeliveries).mockReset();
  });

  it('GET /admin/keys success matches ApiKeyListResponse schema', async () => {
    vi.mocked(keys.listApiKeys).mockResolvedValue([
      {
        id: 'key_1',
        publishableKey: 'pk_test_abc',
        secretLast4: 'abcd',
        mode: 'test',
        allowedOrigins: ['https://shop.example'],
        status: 'active',
        label: null,
        quoteSpreadBps: 0,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        rotatedFromId: null,
        graceExpiresAt: null,
      },
    ] as never);

    const app = createApp();
    const res = await app.request('/admin/keys', { headers: adminHeaders() });

    await expectResponseMatchesSpec(res, { method: 'GET', path: '/admin/keys' });
  });

  it('POST /admin/keys success matches ApiKeyCreatedResponse schema', async () => {
    vi.mocked(keys.createApiKey).mockResolvedValue({
      id: 'key_1',
      publishableKey: 'pk_test_new',
      secretKey: 'sk_test_new',
      secretLast4: 'new1',
      mode: 'test',
      allowedOrigins: ['https://shop.example'],
      status: 'active',
      label: null,
      quoteSpreadBps: 0,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      rotatedFromId: null,
      graceExpiresAt: null,
    } as never);

    const app = createApp();
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ mode: 'test', allowedOrigins: ['https://shop.example'] }),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/admin/keys',
      expectedStatus: 201,
    });
  });

  it('POST /admin/webhooks success matches WebhookEndpointResponse schema', async () => {
    vi.mocked(endpoints.registerEndpoint).mockResolvedValue({
      id: 'wh_1',
      apiKeyId: 'key_1',
      merchantId: null,
      url: 'https://example.com/webhook',
      enabledEvents: ['checkout.session.created'],
      status: 'enabled',
      verified: false,
      description: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      secret: 'whsec_testsecret',
    });

    const app = createApp();
    const res = await app.request('/admin/webhooks', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        apiKeyId: 'key_1',
        url: 'https://example.com/webhook',
        enabledEvents: ['checkout.session.created'],
      }),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/admin/webhooks',
      expectedStatus: 201,
    });
  });

  it('GET /admin/webhooks/dlq success matches WebhookDeliveryListResponse schema', async () => {
    vi.mocked(delivery.listDeadLetterDeliveries).mockResolvedValue([
      {
        id: 'del_1',
        endpointId: 'wh_1',
        eventId: 'evt_1',
        eventType: 'checkout.session.created',
        status: 'dead',
        attempts: 5,
        maxAttempts: 5,
        nextAttemptAt: new Date('2024-01-01T00:00:00.000Z'),
        lastStatusCode: 500,
        lastError: 'delivery failed',
        deliveredAt: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    ]);

    const app = createApp();
    const res = await app.request('/admin/webhooks/dlq', { headers: adminHeaders() });

    await expectResponseMatchesSpec(res, { method: 'GET', path: '/admin/webhooks/dlq' });
  });

  it('POST /admin/webhooks/{id}/verify success matches WebhookVerifyResponse schema', async () => {
    vi.mocked(endpoints.verifyEndpoint).mockResolvedValue({ verified: true });

    const app = createApp();
    const res = await app.request('/admin/webhooks/some-id/verify', {
      method: 'POST',
      headers: adminHeaders(),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/admin/webhooks/{id}/verify',
    });
  });

  it('GET /admin/keys without token matches ErrorEnvelope schema', async () => {
    const app = createApp();
    const res = await app.request('/admin/keys');

    await expectResponseMatchesSpec(res, {
      method: 'GET',
      path: '/admin/keys',
      expectedStatus: 401,
    });
  });
});
