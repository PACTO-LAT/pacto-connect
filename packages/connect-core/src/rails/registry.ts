import {
  type PaymentRailAdapter,
  type PaymentRailRegistry,
  RAIL_ADAPTER_CONTRACT_VERSION,
  RailError,
} from './types.js';

function compareAdapters(a: PaymentRailAdapter, b: PaymentRailAdapter): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  return a.id.localeCompare(b.id);
}

function selectWinningAdapter(candidates: PaymentRailAdapter[]): PaymentRailAdapter {
  return [...candidates].sort(compareAdapters)[0]!;
}

/**
 * Creates an empty payment rail registry.
 *
 * External integrators can register custom rails without modifying core.
 */
export function createPaymentRailRegistry(): PaymentRailRegistry {
  const adapters = new Map<string, PaymentRailAdapter>();

  return {
    register(adapter: PaymentRailAdapter): void {
      if (adapter.contractVersion !== RAIL_ADAPTER_CONTRACT_VERSION) {
        throw new RailError(
          'unsupported_contract_version',
          `Rail "${adapter.id}" declares contract version ${adapter.contractVersion}; ` +
            `expected ${RAIL_ADAPTER_CONTRACT_VERSION}`,
        );
      }

      if (adapters.has(adapter.id)) {
        throw new RailError('duplicate_rail_id', `Rail "${adapter.id}" is already registered`);
      }

      adapters.set(adapter.id, adapter);
    },

    /**
     * Resolves the applicable rail for a country and asset.
     *
     * Precedence when multiple rails qualify:
     * 1. Higher `priority` wins
     * 2. Lexicographically smaller `id` wins (stable tie-break)
     *
     * @throws {RailError} `unknown_country` when no registered rail covers the country
     * @throws {RailError} `unsupported_currency` when the country is known but no rail lists the asset
     */
    resolve(country: string, asset: string): PaymentRailAdapter {
      const all = [...adapters.values()];
      const countryKnown = all.some((adapter) => adapter.countries.includes(country));

      if (!countryKnown) {
        throw new RailError(
          'unknown_country',
          `No payment rail registered for country "${country}"`,
        );
      }

      const candidates = all.filter(
        (adapter) => adapter.countries.includes(country) && adapter.currencies.includes(asset),
      );

      if (candidates.length === 0) {
        throw new RailError(
          'unsupported_currency',
          `No payment rail supports asset "${asset}" in country "${country}"`,
        );
      }

      return selectWinningAdapter(candidates);
    },

    /**
     * Resolves the winning rail for an asset across all registered rails.
     *
     * Uses the same precedence as {@link resolve}: higher priority, then lexicographic id.
     * Returns `null` for USD (numeraire, not owned by a rail).
     */
    resolveByAsset(asset: string): PaymentRailAdapter | null {
      if (asset === 'USD') {
        return null;
      }

      const candidates = [...adapters.values()].filter((adapter) =>
        adapter.currencies.includes(asset),
      );

      if (candidates.length === 0) {
        return null;
      }

      return selectWinningAdapter(candidates);
    },

    listCurrencies(): readonly string[] {
      const currencies = new Set<string>();
      for (const adapter of adapters.values()) {
        for (const currency of adapter.currencies) {
          currencies.add(currency);
        }
      }
      return [...currencies].sort();
    },

    listAdapters(): readonly PaymentRailAdapter[] {
      return [...adapters.values()];
    },
  };
}
