import {
  createDefaultPaymentRailRegistry,
  type PaymentRailRegistry,
  RailError,
} from '@pacto-connect/core';

export type FxCurrency = 'CRC' | 'MXN' | 'USD';

export const FX_CURRENCIES: readonly FxCurrency[] = ['CRC', 'MXN', 'USD'];

export interface FxRate {
  from: FxCurrency;
  to: FxCurrency;
  rate: number;
  source: string;
  asOf: string;
}

export interface FxOracle {
  getRate(from: FxCurrency, to: FxCurrency): FxRate;
}

export class FxOracleError extends Error {
  constructor(
    public readonly code: 'unsupported_currency',
    message: string,
  ) {
    super(message);
    this.name = 'FxOracleError';
  }
}

export interface StaticFxOracleConfig {
  registry?: PaymentRailRegistry;
  usdPer?: Partial<Record<FxCurrency, number>>;
  asOf?: string;
  source?: string;
}

const DEFAULT_AS_OF = '2025-06-01T00:00:00.000Z';
const DEFAULT_SOURCE = 'static';
const defaultRegistry = createDefaultPaymentRailRegistry();

function buildUsdPerTable(
  registry: PaymentRailRegistry,
  overlay?: Partial<Record<FxCurrency, number>>,
): Record<FxCurrency, number> {
  const usdPer: Partial<Record<FxCurrency, number>> = { USD: 1 };

  for (const currency of registry.listCurrencies()) {
    const rail = registry.resolveByAsset(currency);
    if (!rail) {
      continue;
    }

    const quote = rail.quote({ from: 'USD', to: currency, amount: 1 });
    const peg = quote.usdPer[currency];
    if (peg !== undefined) {
      usdPer[currency as FxCurrency] = peg;
    }
  }

  return {
    USD: 1,
    CRC: overlay?.CRC ?? usdPer.CRC ?? 510,
    MXN: overlay?.MXN ?? usdPer.MXN ?? 17,
  };
}

export function isFxCurrency(value: string, registry?: PaymentRailRegistry): value is FxCurrency {
  if (value === 'USD') {
    return true;
  }

  const activeRegistry = registry ?? defaultRegistry;
  return activeRegistry.listCurrencies().includes(value);
}

export function createStaticFxOracle(config?: StaticFxOracleConfig): FxOracle {
  const registry = config?.registry ?? defaultRegistry;
  const usdPer = buildUsdPerTable(registry, config?.usdPer);
  const asOf = config?.asOf ?? DEFAULT_AS_OF;
  const source = config?.source ?? DEFAULT_SOURCE;

  return {
    getRate(from: FxCurrency, to: FxCurrency): FxRate {
      if (!isFxCurrency(from, registry) || !isFxCurrency(to, registry)) {
        throw new FxOracleError(
          'unsupported_currency',
          `Unsupported currency pair: ${from} -> ${to}`,
        );
      }

      for (const currency of [from, to] as const) {
        if (currency !== 'USD' && !registry.resolveByAsset(currency)) {
          throw new FxOracleError(
            'unsupported_currency',
            `Unsupported currency pair: ${from} -> ${to}`,
          );
        }
      }

      const fromPer = usdPer[from];
      const toPer = usdPer[to];

      if (fromPer === undefined || toPer === undefined) {
        throw new FxOracleError(
          'unsupported_currency',
          `Unsupported currency pair: ${from} -> ${to}`,
        );
      }

      const rate = from === to ? 1 : toPer / fromPer;

      return {
        from,
        to,
        rate,
        source,
        asOf,
      };
    },
  };
}

export const staticFxOracle: FxOracle = createStaticFxOracle();

export function resolveRailsForPair(
  registry: PaymentRailRegistry,
  from: FxCurrency,
  to: FxCurrency,
): void {
  for (const currency of [from, to]) {
    if (currency === 'USD') {
      continue;
    }

    const rail = registry.resolveByAsset(currency);
    if (!rail) {
      throw new RailError('unsupported_currency', `No payment rail registered for "${currency}"`);
    }
  }
}
