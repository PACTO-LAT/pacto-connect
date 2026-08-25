import {
  type CheckoutStorageAdapter,
  type DeepPartial,
  type FiatPaymentMethod,
  formatMessage,
  type PactoLocale,
  type PactoMessages,
  type PactoTheme,
  resolveMessages,
  themeToCssVars,
} from '@pacto-connect/core';
import { useEffect, useRef, useState } from 'react';
import { type CheckoutStep, useCheckoutFlow } from './hooks/useCheckoutFlow.js';
import { useFocusTrap } from './hooks/useFocusTrap.js';
import { injectPactoCheckoutStyles } from './styles.js';

const SIMULATOR_STEPS: CheckoutStep[] = ['deposit', 'uploadReceipt', 'tracking'];

function showSimulatorControls(
  testMode: boolean,
  step: CheckoutStep,
  escrow: import('@pacto-connect/core').Escrow | null,
): boolean {
  return testMode && escrow !== null && SIMULATOR_STEPS.includes(step);
}

export interface PactoCheckoutProps {
  publishableKey: string;
  gatewayUrl?: string;
  listingId?: string;
  mode?: 'buy' | 'sell';
  testMode?: boolean;
  storage?: CheckoutStorageAdapter;
  open: boolean;
  onClose: () => void;
  onComplete?: (escrow: import('@pacto-connect/core').Escrow) => void;
  onDispute?: (escrow: import('@pacto-connect/core').Escrow) => void;
  onRefund?: (escrow: import('@pacto-connect/core').Escrow) => void;
  onError?: (error: Error) => void;
  /** Widget copy locale (default `en`). */
  locale?: PactoLocale;
  /** Per-string copy overrides / additional locale. */
  messages?: DeepPartial<PactoMessages>;
  /** Design tokens applied as `--pacto-*` CSS variables. */
  theme?: DeepPartial<PactoTheme>;
  /** Brand logo shown in the checkout header. */
  logoUrl?: string;
  logoAlt?: string;
  /** Inject the default stylesheet (default `true`). Set `false` to self-style. */
  injectStyles?: boolean;
}

export function PactoCheckout(props: PactoCheckoutProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const flow = useCheckoutFlow({
    publishableKey: props.publishableKey,
    gatewayUrl: props.gatewayUrl,
    listingId: props.listingId,
    mode: props.mode,
    testMode: props.testMode,
    storage: props.storage,
    enabled: props.open,
    onComplete: props.onComplete,
    onDispute: props.onDispute,
    onRefund: props.onRefund,
    onError: props.onError,
  });

  const [method, setMethod] = useState<FiatPaymentMethod>('SINPE');
  const [reference, setReference] = useState('');

  const m = resolveMessages(props.locale, props.messages);
  const themeVars = themeToCssVars(props.theme) as React.CSSProperties;

  useEffect(() => {
    if (props.open && props.injectStyles !== false) {
      injectPactoCheckoutStyles();
    }
  }, [props.open, props.injectStyles]);

  useFocusTrap(dialogRef, props.open, props.onClose);

  if (!props.open) {
    return null;
  }

  const titleId = 'pacto-checkout-title';

  return (
    <div className="pacto-checkout-overlay" data-testid="pacto-checkout-overlay" style={themeVars}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pacto-checkout-dialog"
        data-testid="pacto-checkout-dialog"
        tabIndex={-1}
      >
        {flow.testMode && (
          <div
            className="pacto-checkout-test-banner"
            role="status"
            data-testid="checkout-test-banner"
          >
            {m.labels.testBanner}
          </div>
        )}

        <header className="pacto-checkout-header">
          <div className="pacto-checkout-heading">
            {props.logoUrl && (
              <img className="pacto-checkout-logo" src={props.logoUrl} alt={props.logoAlt ?? ''} />
            )}
            <h2 id={titleId}>{m.steps[flow.step]}</h2>
          </div>
          <button type="button" onClick={props.onClose} aria-label={m.actions.closeAria}>
            {m.actions.close}
          </button>
        </header>

        {flow.step === 'loading' && (
          <output aria-live="polite" data-testid="checkout-loading">
            {m.labels.loading}
          </output>
        )}

        {flow.step === 'error' && (
          <div role="alert" data-testid="checkout-error">
            <p>{flow.error?.message ?? m.labels.genericError}</p>
            <button type="button" onClick={flow.retry}>
              {m.actions.retry}
            </button>
          </div>
        )}

        {flow.step === 'selectListing' && (
          <ul role="listbox" aria-label={m.labels.availableListings} data-testid="listing-list">
            {flow.listings.map((listing) => (
              <li key={listing.id}>
                <button type="button" onClick={() => flow.selectListing(listing)}>
                  {listing.asset} — {listing.amount} @ {listing.price}
                </button>
              </li>
            ))}
          </ul>
        )}

        {flow.step === 'deposit' && flow.escrow && (
          <div data-testid="deposit-step">
            <p>
              {formatMessage(m.labels.depositInstruction, {
                amount: flow.escrow.amount,
                asset: flow.escrow.asset,
              })}
            </p>
            <button type="button" onClick={() => flow.confirmDeposit()}>
              {m.actions.confirmDeposit}
            </button>
          </div>
        )}

        {flow.step === 'uploadReceipt' && (
          <form
            data-testid="receipt-form"
            onSubmit={(event) => {
              event.preventDefault();
              flow.submitReceipt(method, reference);
            }}
          >
            <label>
              {m.labels.paymentMethod}
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value as FiatPaymentMethod)}
                aria-label={m.labels.paymentMethod}
              >
                <option value="SINPE">SINPE</option>
                <option value="SPEI">SPEI</option>
              </select>
            </label>
            <label>
              {m.labels.reference}
              <input
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                aria-label={m.labels.referenceAria}
                required
              />
            </label>
            <button type="submit">{m.actions.submitReceipt}</button>
          </form>
        )}

        {flow.step === 'tracking' && (
          <div data-testid="tracking-step" aria-live="polite">
            <p>{m.labels.waiting}</p>
            <ol aria-label={m.labels.escrowMilestones}>
              {flow.milestones.map((milestone) => (
                <li key={milestone.cursor}>{m.milestones[milestone.type]}</li>
              ))}
            </ol>
          </div>
        )}

        {flow.step === 'success' && (
          <output aria-live="polite" data-testid="checkout-success">
            {formatMessage(m.labels.success, { escrowId: flow.escrow?.id ?? '' })}
          </output>
        )}

        {flow.step === 'disputed' && (
          <output aria-live="polite" data-testid="checkout-disputed">
            {formatMessage(m.labels.disputed, { escrowId: flow.escrow?.id ?? '' })}
          </output>
        )}

        {flow.step === 'refunded' && (
          <output aria-live="polite" data-testid="checkout-refunded">
            {formatMessage(m.labels.refunded, { escrowId: flow.escrow?.id ?? '' })}
          </output>
        )}

        {showSimulatorControls(flow.testMode, flow.step, flow.escrow) && (
          <div
            className="pacto-checkout-simulator-controls"
            role="group"
            aria-label={m.labels.simulatorControls}
            data-testid="checkout-simulator-controls"
          >
            <p>{m.labels.simulatorControls}</p>
            <button type="button" onClick={() => flow.controls.forceRelease()}>
              {m.actions.forceRelease}
            </button>
            <button type="button" onClick={() => flow.controls.forceDispute()}>
              {m.actions.forceDispute}
            </button>
            <button type="button" onClick={() => flow.controls.forceTimeout()}>
              {m.actions.forceTimeout}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
