import { beforeEach, describe, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { expectResponseMatchesSpec } from './assert-response.js';
import { mockApiKey, publishableHeaders } from './fixtures.js';

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
  prisma: {},
}));

import * as keys from '../keys.js';

describe('contract: quote route', () => {
  beforeEach(() => {
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
  });

  it('POST /v1/quote success matches FxQuoteResponse schema', async () => {
    const app = createApp();
    const res = await app.request('/v1/quote', {
      method: 'POST',
      headers: publishableHeaders(),
      body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100 }),
    });

    await expectResponseMatchesSpec(res, { method: 'POST', path: '/v1/quote' });
  });

  it('POST /v1/quote validation error matches ErrorEnvelope schema', async () => {
    const app = createApp();
    const res = await app.request('/v1/quote', {
      method: 'POST',
      headers: publishableHeaders(),
      body: JSON.stringify({ from: 'EUR', to: 'CRC', amount: 100 }),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/quote',
      expectedStatus: 400,
    });
  });
});
