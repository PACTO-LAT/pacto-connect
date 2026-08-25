export const RAIL_ADAPTER_CONTRACT_VERSION = 1 as const;

export type RailErrorCode =
  | 'unsupported_country'
  | 'unsupported_currency'
  | 'unsupported_contract_version'
  | 'duplicate_rail_id'
  | 'unknown_country'
  | 'quote_unavailable'
  | 'instruction_unavailable'
  | 'settlement_rejected';

export class RailError extends Error {
  constructor(
    public readonly code: RailErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RailError';
  }
}

export interface RailQuoteInput {
  from: string;
  to: string;
  amount: number;
}

export interface RailQuoteResult {
  rate: number;
  usdPer: Record<string, number>;
  source: string;
  asOf: string;
}

export interface PaymentInstructionInput {
  country: string;
  currency: string;
  amount: number;
  reference?: string;
}

export interface PaymentInstruction {
  railId: string;
  method: string;
  country: string;
  currency: string;
  referenceHint: string;
}

export interface SettlementConfirmationInput {
  reference: string;
  amount?: number;
  currency?: string;
}

export interface SettlementConfirmation {
  status: 'confirmed' | 'rejected' | 'pending';
  reference: string;
  confirmedAt?: string;
}

export interface PaymentRailAdapter {
  readonly id: string;
  readonly priority: number;
  readonly contractVersion: number;
  readonly countries: readonly string[];
  readonly currencies: readonly string[];
  quote(input: RailQuoteInput): RailQuoteResult;
  paymentInstruction(input: PaymentInstructionInput): PaymentInstruction;
  confirmSettlement(input: SettlementConfirmationInput): SettlementConfirmation;
}

export interface PaymentRailRegistry {
  register(adapter: PaymentRailAdapter): void;
  resolve(country: string, asset: string): PaymentRailAdapter;
  resolveByAsset(asset: string): PaymentRailAdapter | null;
  listCurrencies(): readonly string[];
  listAdapters(): readonly PaymentRailAdapter[];
}
