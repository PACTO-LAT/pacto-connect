import type { components } from './generated/openapi.js';

type Schemas = components['schemas'];

/** Public aliases for gateway-backed API entity and request types. */
export type CheckoutMode = Schemas['CheckoutMode'];
export type EscrowStatus = Schemas['EscrowStatus'];
export type Escrow = Schemas['Escrow'];
export type EscrowStatusResponse = Schemas['EscrowStatusBody'];
export type CreateEscrowParams = Pick<Schemas['CreateEscrowRequest'], 'quoteId'>;
export type FiatPaymentMethod = Schemas['FiatPaymentMethod'];
export type FiatReceiptParams = Schemas['FiatReportRequest'];
export type CancelEscrowParams = Schemas['CancelEscrowRequest'];
export type RefundEscrowParams = Schemas['RefundEscrowRequest'];
export type OpenDisputeParams = Schemas['OpenDisputeRequest'];
export type ResolveDisputeParams = Schemas['ResolveDisputeRequest'];
export type EscrowRefund = Schemas['EscrowRefund'];
export type EscrowDispute = Schemas['EscrowDispute'];

/** SDK-only deposit params (gateway ignores extra body fields today). */
export interface DepositParams {
  /** When true, simulates on-chain deposit in Gateway test mode. */
  testMode?: boolean;
}

/** Internal subscription types (not exported from index.ts). */
export type SubscriptionStatus = Schemas['SubscriptionStatus'];
export type SubscriptionInterval = Schemas['SubscriptionInterval'];
export type Subscription = Schemas['Subscription'];
export type CreateSubscriptionParams = Schemas['CreateSubscriptionRequest'];

/** Error envelope shared with gateway responses (partial — middleware may omit fields). */
export type GatewayErrorBody = {
  error?: Partial<Schemas['ErrorBody']>;
};

/** Wire types for session handshake (client maps expiresAt to Date). */
export type GatewaySessionResponse = Schemas['SessionResponse'];
export type GatewayCreateSessionRequest = Schemas['CreateSessionRequest'];
export type GatewayRefreshSessionRequest = Schemas['RefreshSessionRequest'];
