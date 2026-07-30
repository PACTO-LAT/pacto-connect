import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLogSink } from '../logger.js';
import { requestId } from './request-id.js';
import { requestLog } from './request-log.js';

describe('requestLog middleware', () => {
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    setLogSink((line) => {
      lines.push(line);
    });
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    setLogSink(null);
    delete process.env.LOG_LEVEL;
  });

  it('emits a request log line with method, path, status, durationMs, requestId', async () => {
    const app = new Hono();
    app.use('*', requestId());
    app.use('*', requestLog());
    app.get('/health', (c) => c.json({ ok: true }));

    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.msg).toBe('request');
    expect(parsed.level).toBe('info');
    expect(parsed.method).toBe('GET');
    expect(parsed.path).toBe('/health');
    expect(parsed.status).toBe(200);
    expect(parsed.durationMs).toEqual(expect.any(Number));
    expect(Number.isInteger(parsed.durationMs)).toBe(true);
    expect(parsed.requestId).toEqual(expect.any(String));
  });

  it('logs 5xx responses at error level', async () => {
    const app = new Hono();
    app.use('*', requestId());
    app.use('*', requestLog());
    app.get('/boom', (c) => c.json({ error: 'fail' }, 500));

    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.msg).toBe('request');
    expect(parsed.level).toBe('error');
    expect(parsed.status).toBe(500);
    expect(parsed.requestId).toEqual(expect.any(String));
  });
});
