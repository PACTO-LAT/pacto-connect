import { REQUEST_ID_HEADER } from '@pacto-connect/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requestId } from './request-id.js';

function appWithRequestId() {
  const app = new Hono();
  app.use('*', requestId());
  app.get('/ok', (c) => c.json({ ok: true }));
  app.get('/fail', (c) => c.json({ error: 'nope' }, 400));
  return app;
}

describe('requestId middleware', () => {
  it('generates a req_ id when the header is absent', async () => {
    const res = await appWithRequestId().request('/ok');
    expect(res.status).toBe(200);
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(/^req_/);
  });

  it('echoes a valid provided request id', async () => {
    const provided = 'req_custom-id.123';
    const res = await appWithRequestId().request('/ok', {
      headers: { [REQUEST_ID_HEADER]: provided },
    });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(provided);
  });

  it('regenerates on invalid ids', async () => {
    const res = await appWithRequestId().request('/ok', {
      headers: { [REQUEST_ID_HEADER]: 'bad' },
    });
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(/^req_/);
    expect(id).not.toBe('bad');
  });

  it('sets the response header on success responses', async () => {
    const res = await appWithRequestId().request('/ok');
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it('sets the response header on 4xx responses', async () => {
    const res = await appWithRequestId().request('/fail');
    expect(res.status).toBe(400);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/);
  });
});
