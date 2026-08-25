import type {
  CancelEscrowParams,
  CreateEscrowParams,
  CreateSubscriptionParams,
  DepositParams,
  Escrow,
  EscrowDispute,
  EscrowRefund,
  EscrowStatusResponse,
  FiatReceiptParams,
  OpenDisputeParams,
  RefundEscrowParams,
  ResolveDisputeParams,
  Subscription,
} from './api-types.js';
import { type HttpClientOptions, request } from './http.js';

export type {
  CancelEscrowParams,
  CreateEscrowParams,
  DepositParams,
  Escrow,
  EscrowDispute,
  EscrowRefund,
  EscrowStatus,
  EscrowStatusResponse,
  FiatPaymentMethod,
  FiatReceiptParams,
  OpenDisputeParams,
  RefundEscrowParams,
  ResolveDisputeParams,
} from './api-types.js';

export interface Listing {
  id: string;
  asset: string;
  amount: string;
  price: string;
  side: 'buy' | 'sell';
  status: string;
  createdAt: string;
}

export interface Quote {
  id: string;
  listingId?: string;
  asset: string;
  amount: string;
  price: string;
  side: 'buy' | 'sell';
  expiresAt: string;
  createdAt: string;
}

export interface CreateQuoteParams {
  listingId?: string;
  asset: string;
  amount: string;
  price: string;
  side: 'buy' | 'sell';
}

export interface ListingsResource {
  list(): Promise<{ listings: Listing[] }>;
  retrieve(id: string): Promise<{ listing: Listing }>;
}

export interface QuotesResource {
  create(params: CreateQuoteParams): Promise<{ quote: Quote }>;
  retrieve(id: string): Promise<{ quote: Quote }>;
}

export interface EscrowsResource {
  create(params: CreateEscrowParams): Promise<{ escrow: Escrow }>;
  retrieve(id: string): Promise<{ escrow: Escrow }>;
  getStatus(id: string): Promise<{ status: EscrowStatusResponse }>;
  deposit(id: string, params?: DepositParams): Promise<{ escrow: Escrow }>;
  reportFiatPayment(id: string, params: FiatReceiptParams): Promise<{ escrow: Escrow }>;
  cancel(id: string, params?: CancelEscrowParams): Promise<{ escrow: Escrow }>;
  refund(id: string, params: RefundEscrowParams): Promise<{ escrow: Escrow; refund: EscrowRefund }>;
  openDispute(
    id: string,
    params: OpenDisputeParams,
  ): Promise<{ escrow: Escrow; dispute: EscrowDispute }>;
  resolveDispute(
    id: string,
    disputeId: string,
    params: ResolveDisputeParams,
  ): Promise<{ escrow: Escrow; dispute: EscrowDispute }>;
}

export interface SubscriptionsResource {
  create(params: CreateSubscriptionParams): Promise<{ subscription: Subscription }>;
  retrieve(id: string): Promise<{ subscription: Subscription }>;
  list(): Promise<{ subscriptions: Subscription[] }>;
  cancel(id: string): Promise<{ subscription: Subscription }>;
}

export interface TestModeResource {
  forceDispute(escrowId: string, params?: { reason?: string }): Promise<{ escrow: Escrow }>;
  forceTimeout(escrowId: string): Promise<{ escrow: Escrow }>;
  forceRelease(escrowId: string): Promise<{ escrow: Escrow }>;
  advanceSubscription(id: string): Promise<{ result: unknown }>;
  failNextCharge(id: string): Promise<{ ok: boolean }>;
}

export interface PactoApiClient {
  readonly listings: ListingsResource;
  readonly quotes: QuotesResource;
  readonly escrows: EscrowsResource;
  readonly subscriptions: SubscriptionsResource;
  readonly test: TestModeResource;
}

export function createApiClient(options: HttpClientOptions): PactoApiClient {
  return {
    listings: {
      list: () =>
        request<{ listings: Listing[] }>(options, { method: 'GET', path: '/v1/listings' }),
      retrieve: (id) =>
        request<{ listing: Listing }>(options, {
          method: 'GET',
          path: `/v1/listings/${id}`,
          resource: 'listing',
        }),
    },
    quotes: {
      create: (params) =>
        request<{ quote: Quote }>(options, {
          method: 'POST',
          path: '/v1/quotes',
          body: params,
          idempotent: true,
          resource: 'quote',
        }),
      retrieve: (id) =>
        request<{ quote: Quote }>(options, {
          method: 'GET',
          path: `/v1/quotes/${id}`,
          resource: 'quote',
        }),
    },
    escrows: {
      create: (params) =>
        request<{ escrow: Escrow }>(options, {
          method: 'POST',
          path: '/v1/escrows',
          body: params,
          idempotent: true,
          resource: 'escrow',
        }),
      retrieve: (id) =>
        request<{ escrow: Escrow }>(options, {
          method: 'GET',
          path: `/v1/escrows/${id}`,
          resource: 'escrow',
        }),
      getStatus: (id) =>
        request<{ status: EscrowStatusResponse }>(options, {
          method: 'GET',
          path: `/v1/escrows/${id}/status`,
          resource: 'escrow',
        }),
      deposit: (id, params = {}) =>
        request<{ escrow: Escrow }>(options, {
          method: 'POST',
          path: `/v1/escrows/${id}/deposit`,
          body: params,
          idempotent: true,
          resource: 'escrow',
        }),
      reportFiatPayment: (id, params) =>
        request<{ escrow: Escrow }>(options, {
          method: 'POST',
          path: `/v1/escrows/${id}/fiat-receipt`,
          body: params,
          idempotent: true,
          resource: 'escrow',
        }),
      cancel: (id, params) =>
        request<{ escrow: Escrow }>(options, {
          method: 'POST',
          path: `/v1/escrows/${id}/cancel`,
          body: params,
          idempotent: true,
          resource: 'escrow',
        }),
      refund: (id, params) =>
        request<{ escrow: Escrow; refund: EscrowRefund }>(options, {
          method: 'POST',
          path: `/v1/escrows/${id}/refund`,
          body: params,
          idempotent: true,
          resource: 'escrow',
        }),
      openDispute: (id, params) =>
        request<{ escrow: Escrow; dispute: EscrowDispute }>(options, {
          method: 'POST',
          path: `/v1/escrows/${id}/disputes`,
          body: params,
          idempotent: true,
          resource: 'escrow',
        }),
      resolveDispute: (id, disputeId, params) =>
        request<{ escrow: Escrow; dispute: EscrowDispute }>(options, {
          method: 'POST',
          path: `/v1/escrows/${id}/disputes/${disputeId}/resolve`,
          body: params,
          idempotent: true,
          resource: 'escrow',
        }),
    },
    subscriptions: {
      create: (params) =>
        request<{ subscription: Subscription }>(options, {
          method: 'POST',
          path: '/v1/subscriptions',
          body: params,
          idempotent: true,
          resource: 'subscription',
        }),
      retrieve: (id) =>
        request<{ subscription: Subscription }>(options, {
          method: 'GET',
          path: `/v1/subscriptions/${id}`,
          resource: 'subscription',
        }),
      list: () =>
        request<{ subscriptions: Subscription[] }>(options, {
          method: 'GET',
          path: '/v1/subscriptions',
        }),
      cancel: (id) =>
        request<{ subscription: Subscription }>(options, {
          method: 'POST',
          path: `/v1/subscriptions/${id}/cancel`,
          idempotent: true,
          resource: 'subscription',
        }),
    },
    test: {
      forceDispute: (escrowId, params) =>
        request<{ escrow: Escrow }>(options, {
          method: 'POST',
          path: `/v1/test/escrows/${escrowId}/dispute`,
          body: params?.reason !== undefined ? { reason: params.reason } : undefined,
          idempotent: true,
          resource: 'escrow',
        }),
      forceTimeout: (escrowId) =>
        request<{ escrow: Escrow }>(options, {
          method: 'POST',
          path: `/v1/test/escrows/${escrowId}/timeout`,
          idempotent: true,
          resource: 'escrow',
        }),
      forceRelease: (escrowId) =>
        request<{ escrow: Escrow }>(options, {
          method: 'POST',
          path: `/v1/test/escrows/${escrowId}/release`,
          idempotent: true,
          resource: 'escrow',
        }),
      advanceSubscription: (id) =>
        request<{ result: unknown }>(options, {
          method: 'POST',
          path: `/v1/test/subscriptions/${id}/advance`,
          idempotent: true,
        }),
      failNextCharge: (id) =>
        request<{ ok: boolean }>(options, {
          method: 'POST',
          path: `/v1/test/subscriptions/${id}/fail-next`,
          idempotent: true,
        }),
    },
  };
}
