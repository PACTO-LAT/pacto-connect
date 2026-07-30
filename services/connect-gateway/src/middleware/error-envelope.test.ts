import { REQUEST_ID_HEADER } from '@pacto-connect/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { toGatewayErrorBody } from '../errors.js';
import { errorEnvelope } from './error-envelope.js';
import { requestId } from './request-id.js';

function appWithEnvelope() {
  const app = new Hono();
  app.use('*', requestId());
  app.use('*', errorEnvelope());
  return app;
}

describe('errorEnvelope middleware', () => {
  it('adds pactoCode PACTO_SESSION and requestId for session_error bodies', async () => {
    const app = appWithEnvelope();
    app.get('/session', (c) =>
      c.json(toGatewayErrorBody('session_error', 'session_invalid', 'bad'), 401),
    );

    const res = await app.request('/session');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.pactoCode).toBe('PACTO_SESSION');
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error.type).toBe('session_error');
    expect(body.error.code).toBe('session_invalid');
    expect(body.error.message).toBe('bad');
  });

  it('maps rate_limit_error to PACTO_RATE_LIMIT', async () => {
    const app = appWithEnvelope();
    app.get('/limited', (c) =>
      c.json(toGatewayErrorBody('rate_limit_error', 'too_many_requests', 'slow down'), 429),
    );

    const res = await app.request('/limited');
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.pactoCode).toBe('PACTO_RATE_LIMIT');
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it('wraps legacy string error bodies and classifies origin_required as PACTO_AUTH', async () => {
    const app = appWithEnvelope();
    app.get('/origin', (c) => c.json({ error: 'nope', code: 'origin_required' }, 403));

    const res = await app.request('/origin');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: {
        type: 'gateway_error',
        code: 'origin_required',
        message: 'nope',
        pactoCode: 'PACTO_AUTH',
        requestId: expect.any(String),
      },
    });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(body.error.requestId);
  });

  it('leaves 200 responses untouched', async () => {
    const app = appWithEnvelope();
    app.get('/ok', (c) => c.json({ ok: true }));

    const res = await app.request('/ok');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
