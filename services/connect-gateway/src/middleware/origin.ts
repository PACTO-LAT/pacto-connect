import type { Context, Next } from 'hono';
import { findActiveApiKeyByPublishableKey, isOriginAllowed } from '../keys.js';

export const PUBLISHABLE_KEY_HEADER = 'x-pacto-publishable-key';

function extractPublishableKey(c: Context): string | null {
  const headerKey = c.req.header(PUBLISHABLE_KEY_HEADER);
  if (headerKey?.startsWith('pk_')) {
    return headerKey;
  }

  const authorization = c.req.header('Authorization');
  if (authorization?.startsWith('Bearer pk_')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return null;
}

function setCorsHeaders(c: Context, origin: string): void {
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Vary', 'Origin');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  c.header(
    'Access-Control-Allow-Headers',
    `Content-Type, Authorization, ${PUBLISHABLE_KEY_HEADER}`,
  );
}

export async function originValidation(c: Context, next: Next): Promise<Response | void> {
    // Browser CORS preflight requests are generated autonomously by the browser
  // before the actual request and never carry application headers such as
  // x-pacto-publishable-key. Respond immediately so the browser can proceed.
  // Security is enforced on the subsequent real request that follows.
  if (c.req.method === 'OPTIONS') {
    const preflightOrigin = c.req.header('Origin');
    if (preflightOrigin) {
      setCorsHeaders(c, preflightOrigin);
    }
    return c.body(null, 204);
  }
  const publishableKey = extractPublishableKey(c);
  if (!publishableKey) {
    return c.json({ error: 'publishable key required' }, 401);
  }

  const apiKey = await findActiveApiKeyByPublishableKey(publishableKey);
  if (!apiKey) {
    return c.json({ error: 'invalid or revoked publishable key' }, 403);
  }

  const origin = c.req.header('Origin');
  if (!origin) {
    return c.json({ error: 'origin header required' }, 403);
  }

  if (!isOriginAllowed(origin, apiKey.allowedOrigins)) {
    return c.json({ error: 'origin not allowed for this key' }, 403);
  }

  setCorsHeaders(c, origin);

  c.set('apiKey', apiKey);
  await next();
}
