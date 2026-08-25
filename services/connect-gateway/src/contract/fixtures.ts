import type { ApiKey } from '@prisma/client';
import { PUBLISHABLE_KEY_HEADER } from '../middleware/origin.js';

export const mockApiKey: ApiKey = {
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

export const liveApiKey: ApiKey = {
  ...mockApiKey,
  publishableKey: 'pk_live_mockkey',
  mode: 'live',
};

export const allowedOrigin = 'https://allowed.example';

export function publishableHeaders(apiKey: ApiKey = mockApiKey): Record<string, string> {
  return {
    Origin: allowedOrigin,
    [PUBLISHABLE_KEY_HEADER]: apiKey.publishableKey,
    'Content-Type': 'application/json',
  };
}

export function clientSecretHeaders(
  clientSecret: string,
  apiKey: ApiKey = mockApiKey,
): Record<string, string> {
  return {
    ...publishableHeaders(apiKey),
    Authorization: `Bearer ${clientSecret}`,
  };
}

export function adminHeaders(token = 'test-admin-token'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}
