/**
 * Localized copy for the checkout widget. The `en` dictionary is the canonical
 * set and must match the strings the widgets historically hardcoded. Merchants
 * pick a locale via `resolveMessages(locale)` and can patch individual strings
 * — or supply a whole new language — through the `overrides` argument.
 */

import type { CheckoutStep } from './checkout-flow.js';
import type { EscrowEventName } from './escrow-events.js';
import type { DeepPartial } from './theme.js';

export type PactoLocale = 'en' | 'es';

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

export const en: PactoMessages = {
  steps: {
    loading: 'Processing checkout',
    selectListing: 'Select a listing',
    deposit: 'Deposit to escrow',
    uploadReceipt: 'Upload payment receipt',
    tracking: 'Tracking escrow status',
    success: 'Payment complete',
    disputed: 'Escrow disputed',
    refunded: 'Escrow refunded',
    error: 'Checkout error',
  },
  milestones: {
    'escrow.funded': 'Escrow funded',
    'fiat.reported': 'Fiat payment reported',
    released: 'Funds released',
    disputed: 'Escrow disputed',
    cancelled: 'Escrow cancelled',
    refunded: 'Escrow refunded',
    'dispute.resolved': 'Dispute resolved',
  },
  actions: {
    close: 'Close',
    closeAria: 'Close checkout',
    retry: 'Retry',
    confirmDeposit: 'Confirm deposit',
    submitReceipt: 'Submit receipt',
    forceRelease: 'Force release',
    forceDispute: 'Force dispute',
    forceTimeout: 'Force timeout',
  },
  labels: {
    paymentMethod: 'Payment method',
    reference: 'Reference',
    referenceAria: 'Payment reference',
    availableListings: 'Available listings',
    escrowMilestones: 'Escrow milestones',
    simulatorControls: 'Simulator controls',
    loading: 'Loading…',
    waiting: 'Waiting for escrow release…',
    testBanner: 'TEST MODE — no real funds or Stellar transactions',
    genericError: 'Something went wrong',
    depositInstruction: 'Deposit {amount} {asset} to the escrow contract.',
    success: 'Payment complete. Escrow {escrowId} released.',
    disputed: 'Escrow {escrowId} has been disputed.',
    refunded: 'Escrow {escrowId} has been refunded.',
  },
};

export const es: PactoMessages = {
  steps: {
    loading: 'Procesando pago',
    selectListing: 'Selecciona una oferta',
    deposit: 'Depositar en garantía',
    uploadReceipt: 'Sube el comprobante de pago',
    tracking: 'Siguiendo el estado de la garantía',
    success: 'Pago completado',
    disputed: 'Garantía en disputa',
    refunded: 'Garantía reembolsada',
    error: 'Error en el pago',
  },
  milestones: {
    'escrow.funded': 'Garantía fondeada',
    'fiat.reported': 'Pago reportado',
    released: 'Fondos liberados',
    disputed: 'Garantía en disputa',
    cancelled: 'Garantía cancelada',
    refunded: 'Garantía reembolsada',
    'dispute.resolved': 'Disputa resuelta',
  },
  actions: {
    close: 'Cerrar',
    closeAria: 'Cerrar el pago',
    retry: 'Reintentar',
    confirmDeposit: 'Confirmar depósito',
    submitReceipt: 'Enviar comprobante',
    forceRelease: 'Forzar liberación',
    forceDispute: 'Forzar disputa',
    forceTimeout: 'Forzar expiración',
  },
  labels: {
    paymentMethod: 'Método de pago',
    reference: 'Referencia',
    referenceAria: 'Referencia de pago',
    availableListings: 'Ofertas disponibles',
    escrowMilestones: 'Hitos de la garantía',
    simulatorControls: 'Controles del simulador',
    loading: 'Cargando…',
    waiting: 'Esperando la liberación de la garantía…',
    testBanner: 'MODO DE PRUEBA — sin fondos reales ni transacciones en Stellar',
    genericError: 'Algo salió mal',
    depositInstruction: 'Deposita {amount} {asset} al contrato de garantía.',
    success: 'Pago completado. Garantía {escrowId} liberada.',
    disputed: 'La garantía {escrowId} ha sido disputada.',
    refunded: 'La garantía {escrowId} ha sido reembolsada.',
  },
};

const LOCALES: Record<PactoLocale, PactoMessages> = { en, es };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge `patch` onto a structural clone of `base`; never mutates inputs. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isRecord(patch)) {
    return base;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isRecord(current) && isRecord(value)) {
      result[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Resolve a locale to its message set, deep-merged with optional overrides.
 * Unknown locales fall back to English. Pass a full `PactoMessages` shape via
 * `overrides` to register a language that is not built in.
 */
export function resolveMessages(
  locale?: PactoLocale | string,
  overrides?: DeepPartial<PactoMessages>,
): PactoMessages {
  const base = (locale ? LOCALES[locale as PactoLocale] : undefined) ?? en;
  if (!overrides) {
    return base;
  }
  return deepMerge(base, overrides);
}

/** Replace `{name}` placeholders in `template` with values from `params`. */
export function formatMessage(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string): string =>
    key in params ? params[key]! : match,
  );
}
