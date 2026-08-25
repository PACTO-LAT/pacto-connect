import { type PaymentRailAdapter, RAIL_ADAPTER_CONTRACT_VERSION, RailError } from './types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Reusable interface conformance checks for any payment rail adapter.
 *
 * Throws on the first violated invariant. Safe for browser bundles (no test-runner imports).
 */
export function assertPaymentRailConformance(adapter: PaymentRailAdapter): void {
  assert(adapter.id, 'PaymentRailAdapter.id must be truthy');
  assert(
    adapter.contractVersion === RAIL_ADAPTER_CONTRACT_VERSION,
    `PaymentRailAdapter.contractVersion must be ${RAIL_ADAPTER_CONTRACT_VERSION}`,
  );
  assert(adapter.countries.length > 0, 'PaymentRailAdapter.countries must not be empty');
  assert(adapter.currencies.length > 0, 'PaymentRailAdapter.currencies must not be empty');
  assert(typeof adapter.quote === 'function', 'PaymentRailAdapter.quote must be a function');
  assert(
    typeof adapter.paymentInstruction === 'function',
    'PaymentRailAdapter.paymentInstruction must be a function',
  );
  assert(
    typeof adapter.confirmSettlement === 'function',
    'PaymentRailAdapter.confirmSettlement must be a function',
  );

  const country = adapter.countries[0]!;
  const currency = adapter.currencies[0]!;

  const quote = adapter.quote({ from: 'USD', to: currency, amount: 1 });
  assert(Number.isFinite(quote.rate), 'quote.rate must be finite');
  assert(quote.rate > 0, 'quote.rate must be positive');
  assert(quote.source, 'quote.source must be truthy');
  assert(quote.asOf, 'quote.asOf must be truthy');
  assert(
    quote.usdPer[currency] !== undefined && quote.usdPer[currency]! > 0,
    `quote.usdPer must include a positive peg for ${currency}`,
  );

  const instruction = adapter.paymentInstruction({
    country,
    currency,
    amount: 100,
  });
  assert(instruction.railId === adapter.id, 'instruction.railId must match adapter.id');
  assert(instruction.method, 'instruction.method must be truthy');
  assert(instruction.country === country, 'instruction.country must match adapter country');
  assert(instruction.currency === currency, 'instruction.currency must match adapter currency');
  assert(instruction.referenceHint, 'instruction.referenceHint must be truthy');

  const settlement = adapter.confirmSettlement({ reference: 'test-ref-123' });
  assert(
    settlement.status === 'confirmed' ||
      settlement.status === 'rejected' ||
      settlement.status === 'pending',
    'settlement.status must be confirmed, rejected, or pending',
  );
  assert(settlement.reference === 'test-ref-123', 'settlement.reference must echo input');

  try {
    adapter.paymentInstruction({
      country: 'ZZ',
      currency: 'XXX',
      amount: 1,
    });
    throw new Error('paymentInstruction must throw RailError for unsupported country/currency');
  } catch (error) {
    if (!(error instanceof RailError)) {
      throw error;
    }
  }
}
