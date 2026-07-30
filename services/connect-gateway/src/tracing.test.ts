import { SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { REQUEST_ID_HEADER } from '@pacto-connect/core';
import type { ApiKey } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISHABLE_KEY_HEADER } from './middleware/origin.js';
import { initTracing, withSpan } from './tracing.js';

const mockApiKey: ApiKey = {
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

vi.mock('./keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: (origin: string, allowed: string[]) => allowed.includes(origin),
  normalizeOrigin: (raw: string) => {
    try {
      const u = new URL(raw);
      return u.origin.toLowerCase();
    } catch {
      return null;
    }
  },
  createApiKey: vi.fn(),
  cutoverApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  hashSecretKey: vi.fn(),
  generateKeyPair: vi.fn(),
}));

vi.mock('./db.js', () => ({
  prisma: {},
}));

import { createApp } from './app.js';
import * as keys from './keys.js';

describe('tracing', () => {
  const exporter = new InMemorySpanExporter();
  let provider: NodeTracerProvider;

  beforeAll(() => {
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  beforeEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  describe('withSpan', () => {
    it('resolves the value, records attributes, and sets OK status', async () => {
      const value = await withSpan(
        'test.ok',
        { 'pacto.a': 'one', 'pacto.b': 2, 'pacto.c': true },
        async () => 'done',
      );

      expect(value).toBe('done');
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      const span = spans[0]!;
      expect(span.name).toBe('test.ok');
      expect(span.attributes['pacto.a']).toBe('one');
      expect(span.attributes['pacto.b']).toBe(2);
      expect(span.attributes['pacto.c']).toBe(true);
      expect(span.status.code).toBe(SpanStatusCode.OK);
    });

    it('records exception and ERROR status on throw, then rethrows', async () => {
      const err = new Error('boom');
      await expect(
        withSpan('test.fail', {}, async () => {
          throw err;
        }),
      ).rejects.toThrow(err);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      const span = spans[0]!;
      expect(span.name).toBe('test.fail');
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.status.message).toBe('boom');
      expect(span.events.some((e) => e.name === 'exception')).toBe(true);
    });

    it('skips undefined attributes', async () => {
      await withSpan(
        'test.skip-undef',
        { 'pacto.set': 'yes', 'pacto.unset': undefined },
        async () => undefined,
      );

      const span = exporter.getFinishedSpans()[0]!;
      expect(span.attributes['pacto.set']).toBe('yes');
      expect(span.attributes).not.toHaveProperty('pacto.unset');
    });
  });

  describe('initTracing', () => {
    it('returns false when OTEL_EXPORTER_OTLP_ENDPOINT is unset', () => {
      const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      try {
        expect(initTracing()).toBe(false);
      } finally {
        if (previous === undefined) {
          delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        } else {
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
        }
      }
    });
  });

  describe('quote.create instrumentation', () => {
    beforeEach(() => {
      process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
      vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
      vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    });

    it('emits quote.create with pacto.request_id matching the response header', async () => {
      const app = createApp();
      const res = await app.request('/v1/quote', {
        method: 'POST',
        headers: {
          Origin: 'https://allowed.example',
          [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100 }),
      });

      expect(res.status).toBe(200);
      const requestId = res.headers.get(REQUEST_ID_HEADER);
      expect(requestId).toBeTruthy();

      const spans = exporter.getFinishedSpans().filter((s) => s.name === 'quote.create');
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['pacto.request_id']).toBe(requestId);
      expect(spans[0]!.attributes['pacto.api_key_id']).toBe(mockApiKey.id);
      expect(spans[0]!.attributes['pacto.quote_id']).toEqual(expect.any(String));
    });
  });
});
