import {
  type PaymentInstruction,
  type PaymentInstructionInput,
  type PaymentRailAdapter,
  RAIL_ADAPTER_CONTRACT_VERSION,
  RailError,
  type RailQuoteInput,
  type RailQuoteResult,
  type SettlementConfirmation,
  type SettlementConfirmationInput,
} from './types.js';

const DEFAULT_AS_OF = '2025-06-01T00:00:00.000Z';
const DEFAULT_SOURCE = 'static';
const CRC_USD_PER = 510;

function assertSupportedCurrency(currency: string): void {
  if (currency !== 'CRC' && currency !== 'USD') {
    throw new RailError(
      'unsupported_currency',
      `SINPE rail does not support currency "${currency}"`,
    );
  }
}

function computeRate(from: string, to: string): number {
  if (from === to) {
    return 1;
  }

  assertSupportedCurrency(from);
  assertSupportedCurrency(to);

  if (from === 'USD' && to === 'CRC') {
    return CRC_USD_PER;
  }

  if (from === 'CRC' && to === 'USD') {
    return 1 / CRC_USD_PER;
  }

  throw new RailError('quote_unavailable', `SINPE rail cannot quote pair ${from} -> ${to}`);
}

export function createSinpeRail(options?: {
  asOf?: string;
  source?: string;
  priority?: number;
}): PaymentRailAdapter {
  const asOf = options?.asOf ?? DEFAULT_AS_OF;
  const source = options?.source ?? DEFAULT_SOURCE;
  const priority = options?.priority ?? 0;

  return {
    id: 'sinpe',
    priority,
    contractVersion: RAIL_ADAPTER_CONTRACT_VERSION,
    countries: ['CR'],
    currencies: ['CRC'],

    quote(input: RailQuoteInput): RailQuoteResult {
      return {
        rate: computeRate(input.from, input.to),
        usdPer: { CRC: CRC_USD_PER },
        source,
        asOf,
      };
    },

    paymentInstruction(input: PaymentInstructionInput): PaymentInstruction {
      if (input.country !== 'CR' || input.currency !== 'CRC') {
        throw new RailError(
          'instruction_unavailable',
          `SINPE rail cannot produce instructions for ${input.country}/${input.currency}`,
        );
      }

      return {
        railId: 'sinpe',
        method: 'SINPE',
        country: input.country,
        currency: input.currency,
        referenceHint: input.reference ?? 'Use your SINPE mobile number or IBAN as reference',
      };
    },

    confirmSettlement(input: SettlementConfirmationInput): SettlementConfirmation {
      if (!input.reference.trim()) {
        throw new RailError('settlement_rejected', 'Settlement reference is required');
      }

      return {
        status: 'confirmed',
        reference: input.reference,
        confirmedAt: new Date().toISOString(),
      };
    },
  };
}

export const sinpeRail: PaymentRailAdapter = createSinpeRail();
