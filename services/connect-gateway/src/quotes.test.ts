import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuote, verifyQuoteToken } from './quotes.js';

describe('quotes service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a quote with spread-adjusted rate and auditable fields', () => {
    const result = createQuote({
      apiKeyId: 'key_1',
      from: 'USD',
      to: 'CRC',
      amount: 1,
      spreadBps: 100,
    });

    expect(result.baseRate).toBe(510);
    expect(result.effectiveRate).toBe(510 * (1 - 100 / 10000));
    expect(result.effectiveRate).toBe(504.9);
    expect(result.toAmount).toBe(result.amount * result.effectiveRate);
    expect(result.spreadBps).toBe(100);
    expect(result.baseRate).toBeDefined();
    expect(result.spreadBps).toBeDefined();
    expect(result.effectiveRate).toBeDefined();
  });

  it('round-trips a freshly created token', () => {
    const result = createQuote({
      apiKeyId: 'key_1',
      from: 'USD',
      to: 'CRC',
      amount: 10,
      spreadBps: 50,
    });

    const payload = verifyQuoteToken(result.token);

    expect(payload).toEqual({
      quoteId: result.quoteId,
      apiKeyId: 'key_1',
      from: 'USD',
      to: 'CRC',
      amount: 10,
      baseRate: 510,
      spreadBps: 50,
      effectiveRate: 510 * (1 - 50 / 10000),
      toAmount: 10 * 510 * (1 - 50 / 10000),
      source: 'static',
      asOf: '2025-06-01T00:00:00.000Z',
      issuedAt: '2024-06-01T12:00:00.000Z',
      expiresAt: '2024-06-01T12:01:00.000Z',
    });
  });

  it('rejects tampered payload with the original signature', () => {
    const result = createQuote({
      apiKeyId: 'key_1',
      from: 'USD',
      to: 'CRC',
      amount: 1,
      spreadBps: 100,
    });

    const lastDotIndex = result.token.lastIndexOf('.');
    const encoded = result.token.slice(0, lastDotIndex);
    const signature = result.token.slice(lastDotIndex + 1);

    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    parsed.effectiveRate = 999;
    parsed.toAmount = 999;
    const tamperedEncoded = Buffer.from(JSON.stringify(parsed)).toString('base64url');
    const tamperedToken = `${tamperedEncoded}.${signature}`;

    expect(() => verifyQuoteToken(tamperedToken)).toThrow(
      expect.objectContaining({ code: 'quote_invalid' }),
    );
  });

  it('rejects a token with a flipped signature character', () => {
    const result = createQuote({
      apiKeyId: 'key_1',
      from: 'USD',
      to: 'CRC',
      amount: 1,
      spreadBps: 0,
    });

    const lastDotIndex = result.token.lastIndexOf('.');
    const encoded = result.token.slice(0, lastDotIndex);
    const signature = result.token.slice(lastDotIndex + 1);
    const flippedSignature =
      signature[0] === 'a' ? `b${signature.slice(1)}` : `a${signature.slice(1)}`;
    const tamperedToken = `${encoded}.${flippedSignature}`;

    expect(() => verifyQuoteToken(tamperedToken)).toThrow(
      expect.objectContaining({ code: 'quote_invalid' }),
    );
  });

  it('rejects a token with no separator', () => {
    expect(() => verifyQuoteToken('not-a-valid-token')).toThrow(
      expect.objectContaining({ code: 'quote_invalid' }),
    );
  });

  it('rejects expired quotes', () => {
    const result = createQuote({
      apiKeyId: 'key_1',
      from: 'USD',
      to: 'CRC',
      amount: 1,
      spreadBps: 0,
      ttlMs: 1000,
    });

    vi.setSystemTime(new Date('2024-06-01T12:00:01.001Z'));

    expect(() => verifyQuoteToken(result.token)).toThrow(
      expect.objectContaining({ code: 'quote_expired' }),
    );
  });

  it('rejects non-positive amounts', () => {
    expect(() =>
      createQuote({
        apiKeyId: 'key_1',
        from: 'USD',
        to: 'CRC',
        amount: 0,
        spreadBps: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'quote_invalid' }));

    expect(() =>
      createQuote({
        apiKeyId: 'key_1',
        from: 'USD',
        to: 'CRC',
        amount: -1,
        spreadBps: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'quote_invalid' }));
  });

  it('rejects invalid spreadBps values', () => {
    expect(() =>
      createQuote({
        apiKeyId: 'key_1',
        from: 'USD',
        to: 'CRC',
        amount: 1,
        spreadBps: -1,
      }),
    ).toThrow(expect.objectContaining({ code: 'quote_invalid' }));

    expect(() =>
      createQuote({
        apiKeyId: 'key_1',
        from: 'USD',
        to: 'CRC',
        amount: 1,
        spreadBps: 10001,
      }),
    ).toThrow(expect.objectContaining({ code: 'quote_invalid' }));

    expect(() =>
      createQuote({
        apiKeyId: 'key_1',
        from: 'USD',
        to: 'CRC',
        amount: 1,
        spreadBps: 50.5,
      }),
    ).toThrow(expect.objectContaining({ code: 'quote_invalid' }));
  });
});
