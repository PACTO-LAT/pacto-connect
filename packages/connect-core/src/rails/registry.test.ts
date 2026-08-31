import { describe, expect, it } from 'vitest';
import { assertPaymentRailConformance } from './conformance.js';
import { createDefaultPaymentRailRegistry } from './default-registry.js';
import { createPaymentRailRegistry } from './registry.js';
import { createSinpeRail } from './sinpe.js';
import { createSpeiRail } from './spei.js';
import { type PaymentRailAdapter, RAIL_ADAPTER_CONTRACT_VERSION, RailError } from './types.js';

describe('createDefaultPaymentRailRegistry', () => {
  it('registers sinpe and spei by default', () => {
    const registry = createDefaultPaymentRailRegistry();
    expect(registry.listAdapters()).toHaveLength(2);
    expect(registry.resolve('CR', 'CRC').id).toBe('sinpe');
    expect(registry.resolve('MX', 'MXN').id).toBe('spei');
  });
});

describe('createPaymentRailRegistry', () => {
  it('rejects unsupported contract versions at registration', () => {
    const registry = createPaymentRailRegistry();
    const badAdapter: PaymentRailAdapter = {
      ...createSinpeRail(),
      contractVersion: RAIL_ADAPTER_CONTRACT_VERSION + 1,
    };

    expect(() => registry.register(badAdapter)).toThrow(RailError);
    expect(() => registry.register(badAdapter)).toThrow(
      expect.objectContaining({ code: 'unsupported_contract_version' }),
    );
  });

  it('rejects duplicate rail ids', () => {
    const registry = createPaymentRailRegistry();
    registry.register(createSinpeRail());

    expect(() => registry.register(createSinpeRail())).toThrow(RailError);
    expect(() => registry.register(createSinpeRail())).toThrow(
      expect.objectContaining({ code: 'duplicate_rail_id' }),
    );
  });

  it('resolves by higher priority then lexicographic id', () => {
    const registry = createPaymentRailRegistry();

    registry.register({
      ...createSinpeRail(),
      id: 'sinpe-b',
      priority: 10,
    });
    registry.register({
      ...createSpeiRail(),
      id: 'spei-a',
      countries: ['CR'],
      currencies: ['CRC'],
      priority: 10,
    });
    registry.register({
      ...createSinpeRail(),
      id: 'sinpe-a',
      priority: 10,
    });

    expect(registry.resolve('CR', 'CRC').id).toBe('sinpe-a');
  });

  it('throws unknown_country when no rail covers the country', () => {
    const registry = createDefaultPaymentRailRegistry();

    expect(() => registry.resolve('US', 'USD')).toThrow(RailError);
    expect(() => registry.resolve('US', 'USD')).toThrow(
      expect.objectContaining({ code: 'unknown_country' }),
    );
  });

  it('throws unsupported_currency when country is known but asset is not', () => {
    const registry = createDefaultPaymentRailRegistry();

    expect(() => registry.resolve('CR', 'MXN')).toThrow(RailError);
    expect(() => registry.resolve('CR', 'MXN')).toThrow(
      expect.objectContaining({ code: 'unsupported_currency' }),
    );
  });

  it('resolveByAsset returns null for USD', () => {
    const registry = createDefaultPaymentRailRegistry();
    expect(registry.resolveByAsset('USD')).toBeNull();
  });

  it('resolveByAsset picks the same winner as resolve for a single-rail currency', () => {
    const registry = createDefaultPaymentRailRegistry();
    expect(registry.resolveByAsset('CRC')?.id).toBe('sinpe');
    expect(registry.resolveByAsset('MXN')?.id).toBe('spei');
  });

  it('allows external rails to register without modifying core', () => {
    const registry = createPaymentRailRegistry();
    const externalRail: PaymentRailAdapter = {
      id: 'custom-gt',
      priority: 5,
      contractVersion: RAIL_ADAPTER_CONTRACT_VERSION,
      countries: ['GT'],
      currencies: ['GTQ'],
      quote: () => ({
        rate: 7.8,
        usdPer: { GTQ: 7.8 },
        source: 'external',
        asOf: '2025-01-01T00:00:00.000Z',
      }),
      paymentInstruction: (input) => ({
        railId: 'custom-gt',
        method: 'CUSTOM',
        country: input.country,
        currency: input.currency,
        referenceHint: 'external reference',
      }),
      confirmSettlement: (input) => ({
        status: 'confirmed',
        reference: input.reference,
      }),
    };

    registry.register(externalRail);
    expect(registry.resolve('GT', 'GTQ').id).toBe('custom-gt');
    expect(registry.resolveByAsset('GTQ')?.id).toBe('custom-gt');
    expect(registry.listCurrencies()).toContain('GTQ');
  });
});

describe('assertPaymentRailConformance', () => {
  it('passes for built-in sinpe rail', () => {
    assertPaymentRailConformance(createSinpeRail());
  });

  it('passes for built-in spei rail', () => {
    assertPaymentRailConformance(createSpeiRail());
  });
});
