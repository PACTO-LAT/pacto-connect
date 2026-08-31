import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, setLogSink } from './logger.js';

describe('createLogger', () => {
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

  it('emits parseable single-line JSON with level, time, service, msg and merged fields', () => {
    const log = createLogger({ requestId: 'req_abc' });
    log.info('hello', { path: '/health' });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.time).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(parsed.time))).toBe(false);
    expect(parsed.service).toBe('connect-gateway');
    expect(parsed.msg).toBe('hello');
    expect(parsed.requestId).toBe('req_abc');
    expect(parsed.path).toBe('/health');
  });

  it('respects LOG_LEVEL filtering', () => {
    process.env.LOG_LEVEL = 'warn';
    const log = createLogger();
    log.info('skipped');
    log.warn('kept');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).msg).toBe('kept');
  });

  it('serializes Error fields as name/message/stack', () => {
    const log = createLogger();
    const err = new Error('boom');
    log.error('failed', { error: err });

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.error).toEqual({
      name: 'Error',
      message: 'boom',
      stack: err.stack,
    });
  });

  it('child() merges bindings into subsequent lines', () => {
    const log = createLogger({ serviceExtra: 1 }).child({ requestId: 'req_1' });
    log.info('childed');
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.serviceExtra).toBe(1);
    expect(parsed.requestId).toBe('req_1');
  });
});
