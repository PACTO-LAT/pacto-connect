import type { CheckoutStep } from '../checkout-flow.js';
import type { EscrowEventName } from '../escrow-events.js';

export type PactoLocale = 'en' | 'es' | 'pt';

/** ISO-3166 region supplied by the selected payment rail (e.g. the fiat rail's country). */
export type RailRegion = 'BR' | 'CR' | 'MX' | string;

export interface LocaleResolutionOptions {
  /** Explicit host preference; takes precedence over the payment rail. */
  locale?: PactoLocale | string;
  /** ISO-3166 region supplied by the selected payment rail. */
  railRegion?: RailRegion;
}

export interface PactoMessages {
  steps: Record<CheckoutStep, string>;
  milestones: Record<EscrowEventName, string>;
  actions: {
    close: string;
    closeAria: string;
    retry: string;
    confirmDeposit: string;
    submitReceipt: string;
    forceRelease: string;
    forceDispute: string;
    forceTimeout: string;
  };
  labels: {
    paymentMethod: string;
    reference: string;
    referenceAria: string;
    availableListings: string;
    escrowMilestones: string;
    simulatorControls: string;
    loading: string;
    waiting: string;
    testBanner: string;
    genericError: string;
    quoteExpired: string;
    /** Placeholders: {amount} {asset} */
    depositInstruction: string;
    /** Placeholder: {escrowId} */
    success: string;
    /** Placeholder: {escrowId} */
    disputed: string;
    /** Placeholder: {escrowId} */
    refunded: string;
  };
}
