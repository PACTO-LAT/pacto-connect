import { expect } from 'vitest';
import { type PaymentRailAdapter, RAIL_ADAPTER_CONTRACT_VERSION, RailError } from './types.js';

/**
 * Reusable interface conformance checks for any payment rail adapter.
 */
export function assertPaymentRailConformance(adapter: PaymentRailAdapter): void {
  expect(adapter.id).toBeTruthy();
  expect(adapter.contractVersion).toBe(RAIL_ADAPTER_CONTRACT_VERSION);
  expect(adapter.countries.length).toBeGreaterThan(0);
  expect(adapter.currencies.length).toBeGreaterThan(0);
  expect(typeof adapter.quote).toBe('function');
  expect(typeof adapter.paymentInstruction).toBe('function');
  expect(typeof adapter.confirmSettlement).toBe('function');

  const country = adapter.countries[0]!;
  const currency = adapter.currencies[0]!;

  const quote = adapter.quote({ from: 'USD', to: currency, amount: 1 });
  expect(Number.isFinite(quote.rate)).toBe(true);
  expect(quote.rate).toBeGreaterThan(0);
  expect(quote.source).toBeTruthy();
  expect(quote.asOf).toBeTruthy();
  expect(quote.usdPer[currency]).toBeGreaterThan(0);

  const instruction = adapter.paymentInstruction({
    country,
    currency,
    amount: 100,
  });
  expect(instruction.railId).toBe(adapter.id);
  expect(instruction.method).toBeTruthy();
  expect(instruction.country).toBe(country);
  expect(instruction.currency).toBe(currency);
  expect(instruction.referenceHint).toBeTruthy();

  const settlement = adapter.confirmSettlement({ reference: 'test-ref-123' });
  expect(['confirmed', 'rejected', 'pending']).toContain(settlement.status);
  expect(settlement.reference).toBe('test-ref-123');

  expect(() =>
    adapter.paymentInstruction({
      country: 'ZZ',
      currency: 'XXX',
      amount: 1,
    }),
  ).toThrow(RailError);
}
