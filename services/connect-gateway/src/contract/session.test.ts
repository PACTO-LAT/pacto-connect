import { beforeEach, describe, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { SessionError } from '../errors.js';
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

vi.mock('../sessions.js', () => ({
  createCheckoutSession: vi.fn(),
  refreshCheckoutSession: vi.fn(),
}));

vi.mock('../db.js', () => ({
  prisma: {},
}));

import * as keys from '../keys.js';
import * as sessions from '../sessions.js';

describe('contract: session routes', () => {
  beforeEach(() => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(sessions.createCheckoutSession).mockReset();
    vi.mocked(sessions.refreshCheckoutSession).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
  });

  it('POST /v1/session success matches SessionResponse schema', async () => {
    vi.mocked(sessions.createCheckoutSession).mockResolvedValue({
      sessionId: 'session_1',
      clientSecret: 'cs_session_1_signature',
      expiresAt: new Date('2024-01-01T00:15:00.000Z'),
      mode: 'buy',
      merchantId: null,
    });

    const app = createApp();
    const res = await app.request('/v1/session', {
      method: 'POST',
      headers: publishableHeaders(),
      body: JSON.stringify({ listingId: 'listing_1', mode: 'buy' }),
    });

    await expectResponseMatchesSpec(res, { method: 'POST', path: '/v1/session' });
  });

  it('POST /v1/session validation error matches ErrorEnvelope schema', async () => {
    const app = createApp();
    const res = await app.request('/v1/session', {
      method: 'POST',
      headers: publishableHeaders(),
      body: JSON.stringify({ mode: 'buy' }),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/session',
      expectedStatus: 400,
    });
  });

  it('POST /v1/session/refresh success matches SessionResponse schema', async () => {
    vi.mocked(sessions.refreshCheckoutSession).mockResolvedValue({
      sessionId: 'session_1',
      clientSecret: 'cs_session_1_new_signature',
      expiresAt: new Date('2024-01-01T00:30:00.000Z'),
      mode: 'sell',
      merchantId: null,
    });

    const app = createApp();
    const res = await app.request('/v1/session/refresh', {
      method: 'POST',
      headers: publishableHeaders(),
      body: JSON.stringify({ clientSecret: 'cs_session_1_signature' }),
    });

    await expectResponseMatchesSpec(res, { method: 'POST', path: '/v1/session/refresh' });
  });

  it('POST /v1/session/refresh expired session matches ErrorEnvelope schema', async () => {
    vi.mocked(sessions.refreshCheckoutSession).mockRejectedValue(
      new SessionError('session_expired', 'Session has expired'),
    );

    const app = createApp();
    const res = await app.request('/v1/session/refresh', {
      method: 'POST',
      headers: publishableHeaders(),
      body: JSON.stringify({ clientSecret: 'cs_session_1_signature' }),
    });

    await expectResponseMatchesSpec(res, {
      method: 'POST',
      path: '/v1/session/refresh',
      expectedStatus: 410,
    });
  });
});
