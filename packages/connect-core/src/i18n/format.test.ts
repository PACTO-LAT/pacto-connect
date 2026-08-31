import { describe, expect, it } from 'vitest';
import { formatAssetAmount, formatCurrency, formatDate } from './format.js';

describe('formatCurrency', () => {
  it('formats the same amount differently across locales', () => {
    const enAmount = formatCurrency(1234.5, 'USD', 'en');
    const esAmount = formatCurrency(1234.5, 'USD', 'es');
    const ptAmount = formatCurrency(1234.5, 'BRL', 'pt');

    expect(enAmount).not.toBe(esAmount);
    expect(enAmount).not.toBe(ptAmount);
    expect(esAmount).not.toBe(ptAmount);
  });

  it('uses a comma as the decimal separator for pt-formatted amounts', () => {
    // The bug this closes: a Brazilian buyer must never see the raw "1,234.50" (en-US grouping).
    const ptAmount = formatCurrency(1234.5, 'BRL', 'pt');
    expect(ptAmount).toContain('1.234,50');
    expect(ptAmount).not.toContain('1,234.50');
  });

  it('uses a period as the decimal separator for en-formatted amounts', () => {
    const enAmount = formatCurrency(1234.5, 'USD', 'en');
    expect(enAmount).toContain('1,234.50');
  });
});

describe('formatAssetAmount', () => {
  it('formats a crypto asset quantity per locale without an ISO-4217 currency code', () => {
    // The bug this closes: Intl.NumberFormat's `currency` style throws on a ticker
    // like "USDC" ("Invalid currency code"), since listings/escrows deal in crypto
    // assets, not ISO-4217 money. Amounts still need locale-correct separators.
    expect(() => formatAssetAmount(1234.5, 'en')).not.toThrow();
    expect(formatAssetAmount(1234.5, 'en')).toBe('1,234.50');
    expect(formatAssetAmount(1234.5, 'pt')).toBe('1.234,50');
    expect(formatAssetAmount(1234.5, 'en')).not.toBe(formatAssetAmount(1234.5, 'pt'));
  });
});

describe('formatDate', () => {
  const date = '2024-12-31T00:00:00.000Z';

  it('formats the same date differently across locales', () => {
    const enDate = formatDate(date, 'en');
    const esDate = formatDate(date, 'es');
    const ptDate = formatDate(date, 'pt');

    expect(enDate).not.toBe(esDate);
    expect(enDate).not.toBe(ptDate);
  });

  it('accepts Date instances and epoch millis, not just ISO strings', () => {
    const fromString = formatDate(date, 'en');
    const fromDate = formatDate(new Date(date), 'en');
    const fromEpoch = formatDate(new Date(date).getTime(), 'en');

    expect(fromDate).toBe(fromString);
    expect(fromEpoch).toBe(fromString);
  });
});
