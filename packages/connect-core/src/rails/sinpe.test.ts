import { describe, expect, it } from 'vitest';
import { createSinpeRail } from './sinpe.js';
import { RailError } from './types.js';

describe('SINPE rail', () => {
  const rail = createSinpeRail();

  it('quotes USD to CRC at 510', () => {
    const quote = rail.quote({ from: 'USD', to: 'CRC', amount: 1 });
    expect(quote.rate).toBe(510);
    expect(quote.usdPer.CRC).toBe(510);
    expect(quote.source).toBe('static');
    expect(quote.asOf).toBe('2025-06-01T00:00:00.000Z');
  });

  it('quotes CRC to USD as inverse', () => {
    const quote = rail.quote({ from: 'CRC', to: 'USD', amount: 510 });
    expect(quote.rate).toBeCloseTo(1 / 510);
  });

  it('returns payment instructions for Costa Rica CRC', () => {
    const instruction = rail.paymentInstruction({
      country: 'CR',
      currency: 'CRC',
      amount: 1000,
    });

    expect(instruction).toEqual({
      railId: 'sinpe',
      method: 'SINPE',
      country: 'CR',
      currency: 'CRC',
      referenceHint: expect.any(String),
    });
  });

  it('confirms settlement with a reference', () => {
    const result = rail.confirmSettlement({ reference: 'ref-123' });
    expect(result.status).toBe('confirmed');
    expect(result.reference).toBe('ref-123');
    expect(result.confirmedAt).toBeTruthy();
  });

  it('rejects unsupported currency pairs', () => {
    expect(() => rail.quote({ from: 'USD', to: 'MXN', amount: 1 })).toThrow(RailError);
    expect(() => rail.quote({ from: 'USD', to: 'MXN', amount: 1 })).toThrow(
      expect.objectContaining({ code: 'unsupported_currency' }),
    );
  });
});
