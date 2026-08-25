import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { signPayload, WEBHOOK_SIGNATURE_HEADER } from '../webhooks/signature.js';
import { expectResponseMatchesSpec } from './assert-response.js';

vi.mock('../webhooks/nonce.js', () => ({
  consumeNonce: vi.fn(),
  releaseNonce: vi.fn(),
}));
vi.mock('../webhooks/delivery.js', () => ({
  dispatchEvent: vi.fn(),
}));
vi.mock('../merchants.js', () => ({
  findActiveMerchant: vi.fn(),
}));
vi.mock('../keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: (origin: string, allowed: string[]) => allowed.includes(origin),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  hashSecretKey: vi.fn(),
  generateKeyPair: vi.fn(),
}));
vi.mock('../db.js', () => ({
  prisma: {},
}));

import { dispatchEvent } from '../webhooks/delivery.js';
import { consumeNonce } from '../webhooks/nonce.js';

const SECRET = 'whsec_inbound_secret';
const NOW = 1_700_000_000;

function signedRequest(body: string) {
  const header = signPayload(body, SECRET, NOW, 'nonce_1');
  return {
    method: 'POST',
    headers: { [WEBHOOK_SIGNATURE_HEADER]: header, 'Content-Type': 'application/json' },
    body,
  };
}

const validBody = JSON.stringify({
  id: 'up_evt_1',
  apiKeyId: 'key_1',
  type: 'escrow.created',
  data: { escrowId: 'esc_1' },
});

describe('contract: inbound webhook route', () => {
  beforeEach(() => {
    process.env.PACTO_WEBHOOK_SECRET = SECRET;
    process.env.WEBHOOK_REPLAY_TOLERANCE_SECONDS = '300';
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
    vi.mocked(consumeNonce).mockReset();
    vi.mocked(dispatchEvent).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('POST /v1/webhooks/inbound success matches InboundWebhookResponse schema', async () => {
    vi.mocked(consumeNonce).mockResolvedValue(true);
    vi.mocked(dispatchEvent).mockResolvedValue({ eventId: 'evt_1', deliveries: 1 });

    const app = createApp();
    const res = await app.request('/v1/webhooks/inbound', signedRequest(validBody));

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/webhooks/inbound',
    });
  });

  it('POST /v1/webhooks/inbound invalid signature matches ErrorEnvelope schema', async () => {
    const app = createApp();
    const res = await app.request('/v1/webhooks/inbound', {
      method: 'POST',
      headers: {
        [WEBHOOK_SIGNATURE_HEADER]: 'invalid',
        'Content-Type': 'application/json',
      },
      body: validBody,
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/webhooks/inbound',
      expectedStatus: 400,
    });
  });
});
