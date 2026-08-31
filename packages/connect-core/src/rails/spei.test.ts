import { describe, expect, it } from 'vitest';
import { createSpeiRail } from './spei.js';
import { RailError } from './types.js';

describe('SPEI rail', () => {
  const rail = createSpeiRail();

  it('quotes USD to MXN at 17', () => {
    const quote = rail.quote({ from: 'USD', to: 'MXN', amount: 1 });
    expect(quote.rate).toBe(17);
    expect(quote.usdPer.MXN).toBe(17);
    expect(quote.source).toBe('static');
    expect(quote.asOf).toBe('2025-06-01T00:00:00.000Z');
  });

  it('quotes MXN to USD as inverse', () => {
    const quote = rail.quote({ from: 'MXN', to: 'USD', amount: 17 });
    expect(quote.rate).toBeCloseTo(1 / 17);
  });

  it('returns payment instructions for Mexico MXN', () => {
    const instruction = rail.paymentInstruction({
      country: 'MX',
      currency: 'MXN',
      amount: 500,
    });

    expect(instruction).toEqual({
      railId: 'spei',
      method: 'SPEI',
      country: 'MX',
      currency: 'MXN',
      referenceHint: expect.any(String),
    });
  });

  it('confirms settlement with a reference', () => {
    const result = rail.confirmSettlement({ reference: 'clabe-123' });
    expect(result.status).toBe('confirmed');
    expect(result.reference).toBe('clabe-123');
    expect(result.confirmedAt).toBeTruthy();
  });

  it('rejects unsupported currency pairs', () => {
    expect(() => rail.quote({ from: 'USD', to: 'CRC', amount: 1 })).toThrow(RailError);
    expect(() => rail.quote({ from: 'USD', to: 'CRC', amount: 1 })).toThrow(
      expect.objectContaining({ code: 'unsupported_currency' }),
    );
  });
});
