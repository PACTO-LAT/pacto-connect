import type { CheckoutStep } from '../checkout-flow.js';
import { en } from './catalogues/index.js';
import type { PactoLocale, PactoMessages } from './types.js';

/** Replace `{name}` placeholders in `template` with values from `params`. */
export function formatMessage(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string): string =>
    key in params ? params[key]! : match,
  );
}

function isDevelopmentMode(): boolean {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

type KeyedSection = 'steps' | 'milestones';

/**
 * Resolve a message from a dynamically-keyed catalogue section (e.g.
 * `messages.steps[step]`), for keys whose validity can only be known at
 * runtime (a step or milestone name coming from a live checkout/escrow state).
 *
 * In development a missing key throws immediately, so a drifted catalogue is
 * caught before it ships. In production it falls back to the English copy (or
 * to the raw key, if even `en` lacks it) so a merchant's checkout never
 * renders a blank string or crashes.
 */
export function resolveKeyedMessage(
  messages: PactoMessages,
  section: KeyedSection,
  key: string,
  locale: PactoLocale,
): string {
  const value = (messages[section] as Record<string, string>)[key];
  if (value !== undefined) {
    return value;
  }

  if (isDevelopmentMode()) {
    throw new Error(
      `[pacto-connect] Missing i18n key "${section}.${key}" for locale "${locale}". ` +
        'Add it to every catalogue in packages/connect-core/src/i18n/catalogues.',
    );
  }

  return (en[section] as Record<string, string>)[key] ?? key;
}

/**
 * Resolves the copy a screen-reader live region should announce for the
 * current checkout step, shared by every widget surface (React, the web
 * component, and the React Native sheet's native chrome) so a step change or
 * terminal state is described identically everywhere.
 *
 * Terminal steps that carry an escrow id announce the same detailed copy
 * shown on screen (e.g. "Payment complete. Escrow esc_1 released."); every
 * other step announces its `steps` catalogue entry (e.g. "Deposit to
 * escrow").
 */
export function resolveStepAnnouncement(
  messages: PactoMessages,
  locale: PactoLocale,
  step: CheckoutStep,
  escrowId?: string | null,
): string {
  switch (step) {
    case 'success':
      return formatMessage(messages.labels.success, { escrowId: escrowId ?? '' });
    case 'disputed':
      return formatMessage(messages.labels.disputed, { escrowId: escrowId ?? '' });
    case 'refunded':
      return formatMessage(messages.labels.refunded, { escrowId: escrowId ?? '' });
    default:
      return resolveKeyedMessage(messages, 'steps', step, locale);
  }
}
