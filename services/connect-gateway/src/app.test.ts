import type { ApiKey } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { PUBLISHABLE_KEY_HEADER } from './middleware/origin.js';

const mockApiKey: ApiKey = {
  id: 'key_1',
  publishableKey: 'pk_test_mockkey',
  secretKeyHash: 'hash',
  secretLast4: 'abcd',
  mode: 'test',
  allowedOrigins: ['https://allowed.example'],
  status: 'active',
  label: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

vi.mock('./keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: (origin: string, allowed: string[]) => allowed.includes(origin),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  hashSecretKey: vi.fn(),
  generateKeyPair: vi.fn(),
}));

vi.mock('./db.js', () => ({
  prisma: {},
}));

import * as keys from './keys.js';

describe('origin validation middleware', () => {
  beforeEach(() => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
  });

  it('rejects requests without a publishable key', async () => {
    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: { Origin: 'https://allowed.example' },
    });

    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid origin', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: {
        Origin: 'https://evil.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin not allowed for this key' });
  });

  it('rejects requests without an origin header', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: { [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin header required' });
  });

  it('rejects revoked or unknown keys', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(null);

    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: 'pk_test_revoked',
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'invalid or revoked publishable key' });
  });

  it('allows valid origin and sets strict CORS headers', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
      },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

 diff --git a/services/connect-gateway/src/app.test.ts b/services/connect-gateway/src/app.test.ts
index 73d7ec7..aac3092 100644
--- a/services/connect-gateway/src/app.test.ts
+++ b/services/connect-gateway/src/app.test.ts
@@ -106,20 +106,37 @@ describe('origin validation middleware', () => {
     expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
   });
 
-  it('handles CORS preflight for allowed origins', async () => {
-    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
-
+  it('handles CORS preflight for allowed origins without a publishable key', async () => {
+    // Browsers never attach application headers (e.g. x-pacto-publishable-key)
+    // to the autonomous OPTIONS preflight they send before the real request.
+    // The gateway must return 204 + CORS headers without requiring the key.
     const app = createApp();
     const res = await app.request('/v1/session', {
       method: 'OPTIONS',
       headers: {
         Origin: 'https://allowed.example',
-        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
+        'Access-Control-Request-Method': 'POST',
+        'Access-Control-Request-Headers': `content-type,${PUBLISHABLE_KEY_HEADER}`,
       },
     });
 
     expect(res.status).toBe(204);
     expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
+    expect(res.headers.get('Access-Control-Allow-Methods')).toMatch(/POST/);
+    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(
+      new RegExp(PUBLISHABLE_KEY_HEADER, 'i'),
+    );
+  });
+
+  it('returns 204 for OPTIONS even when no publishable key is present (regression)', async () => {
+    const app = createApp();
+    const res = await app.request('/v1/session', {
+      method: 'OPTIONS',
+      headers: { Origin: 'https://merchant.example' },
+    });
+
+    // Must not be 401 — that would block every browser preflight
+    expect(res.status).toBe(204);
   });
 
   it('does not require origin validation on /health', async () => {
diff --git a/services/connect-gateway/src/middleware/origin.ts b/services/connect-gateway/src/middleware/origin.ts
index b740ba8..04ce54a 100644
--- a/services/connect-gateway/src/middleware/origin.ts
+++ b/services/connect-gateway/src/middleware/origin.ts
@@ -29,6 +29,18 @@ function setCorsHeaders(c: Context, origin: string): void {
 }
 
 export async function originValidation(c: Context, next: Next): Promise<Response | void> {
+  // Browser CORS preflight requests are generated autonomously by the browser
+  // before the actual request and never carry application headers such as
+  // x-pacto-publishable-key. Respond immediately so the browser can proceed.
+  // Security is enforced on the subsequent real request that follows.
+  if (c.req.method === 'OPTIONS') {
+    const preflightOrigin = c.req.header('Origin');
+    if (preflightOrigin) {
+      setCorsHeaders(c, preflightOrigin);
+    }
+    return c.body(null, 204);
+  }
+
   const publishableKey = extractPublishableKey(c);
   if (!publishableKey) {
     return c.json({ error: 'publishable key required' }, 401);
@@ -50,10 +62,6 @@ export async function originValidation(c: Context, next: Next): Promise<Response
 
   setCorsHeaders(c, origin);
 
-  if (c.req.method === 'OPTIONS') {
-    return c.body(null, 204);
-  }
-
   c.set('apiKey', apiKey);
   await next();
 }

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
  });

  it('does not require origin validation on /health', async () => {
    const app = createApp();
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'connect-gateway' });
  });
});

it('returns 204 for OPTIONS even when no publishable key is present (regression)', async () => {
  const app = createApp();
  const res = await app.request('/v1/session', {
    method: 'OPTIONS',
    headers: { Origin: 'https://merchant.example' },
  });

  expect(res.status).toBe(204);
});
describe('admin routes', () => {
  beforeEach(() => {
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
  });

  it('rejects admin requests without token', async () => {
    const app = createApp();
    const res = await app.request('/admin/keys');

    expect(res.status).toBe(401);
  });

  it('lists keys without exposing secret material', async () => {
    vi.mocked(keys.listApiKeys).mockResolvedValue([
      {
        id: 'key_1',
        publishableKey: 'pk_test_mockkey',
        secretLast4: 'abcd',
        mode: 'test',
        allowedOrigins: ['https://allowed.example'],
        status: 'active',
        label: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    ]);

    const app = createApp();
    const res = await app.request('/admin/keys', {
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys[0]).not.toHaveProperty('secretKey');
    expect(body.keys[0]).not.toHaveProperty('secretKeyHash');
    expect(body.keys[0].secretLast4).toBe('abcd');
  });

  it('returns secret key only once on create', async () => {
    vi.mocked(keys.createApiKey).mockResolvedValue({
      id: 'key_new',
      publishableKey: 'pk_test_new',
      secretKey: 'sk_test_newsecret',
      secretLast4: 'cret',
      mode: 'test',
      allowedOrigins: ['https://allowed.example'],
      status: 'active',
      label: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = createApp();
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'test',
        allowedOrigins: ['https://allowed.example'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key.secretKey).toMatch(/^sk_test_/);
    expect(body.key.publishableKey).toMatch(/^pk_test_/);
  });
});

describe('keys service hashing', () => {
  it('never stores plaintext secrets in hash output', async () => {
    const { hashSecretKey } = await vi.importActual<typeof import('./keys.js')>('./keys.js');
    const secret = 'sk_test_supersecretvalue';
    const hash = hashSecretKey(secret);

    expect(hash).not.toContain(secret);
    expect(hash).toHaveLength(64);
  });
});
