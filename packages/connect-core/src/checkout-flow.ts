import {
  applyCheckoutTransition,
  type CheckoutFlowState,
  CheckoutQuoteExpiredError,
  type CheckoutStep,
  createInitialCheckoutState,
  isPersistableStep,
  isQuoteExpired,
  isTerminalCheckoutStep,
} from './checkout-machine.js';
import {
  buildCheckoutSnapshotScope,
  type CheckoutSnapshot,
  type CheckoutStorageAdapter,
  checkoutStorageKey,
  isCheckoutSnapshotExpired,
  parseCheckoutSnapshot,
  serializeCheckoutSnapshot,
  snapshotMatchesScope,
} from './checkout-storage.js';
import {
  type CheckoutMode,
  Pacto,
  type PactoClient,
  type PactoInitOptions,
  type PactoSession,
  type PactoSessionData,
} from './client.js';
import type { EscrowEvent } from './escrow-events.js';
import { en, resolveMessages } from './i18n.js';
import { isTestMode } from './keys.js';
import type { Escrow, Listing, PactoApiClient, Quote } from './resources.js';

export type { CheckoutFlowState, CheckoutStep };

/** Resilience knobs forwarded verbatim to `Pacto.init()` — see `client.ts` for defaults. */
export type CheckoutFlowResilienceOptions = Pick<
  PactoInitOptions,
  | 'maxRetries'
  | 'baseDelayMs'
  | 'maxDelayMs'
  | 'retryBudget'
  | 'timeoutMs'
  | 'streamIdleTimeoutMs'
  | 'breaker'
  | 'onBreakerStateChange'
  | 'maxReconnectAttempts'
>;

export interface CheckoutFlowOptions {
  publishableKey: string;
  gatewayUrl?: string;
  listingId?: string;
  mode?: CheckoutMode;
  testMode?: boolean;
  /** Pre-created session; skips POST /v1/session when provided. */
  session?: PactoSessionData;
  storage?: CheckoutStorageAdapter;
  now?: () => number;
  /** Overrides the SDK's default resilience policy (timeouts, retry budget, backoff, circuit breaker). */
  resilience?: CheckoutFlowResilienceOptions;
  onChange?: (state: CheckoutFlowState) => void;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onRefund?: (escrow: Escrow) => void;
  onError?: (error: Error) => void;
}

export class CheckoutFlowController {
  private state: CheckoutFlowState;
  private session: PactoSession | null = null;
  private client: PactoClient | null = null;
  private api: PactoApiClient | null = null;
  private escrow: Escrow | null = null;
  private eventsBound = false;
  private destroyed = false;

  constructor(private readonly options: CheckoutFlowOptions) {
    this.state = createInitialCheckoutState(isTestMode(options.publishableKey));
  }

  getState(): CheckoutFlowState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.options.session) {
      await this.initialize();
      return;
    }

    const hydrated = await this.tryHydrate();
    if (!hydrated) {
      await this.initialize();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.session?.closeEvents();
    this.session = null;
    this.client = null;
    this.api = null;
    this.escrow = null;
    this.eventsBound = false;
  }

  async selectListing(listing: Listing): Promise<void> {
    this.patchState({ selectedListing: listing, step: 'loading' });
    try {
      await this.createQuoteAndEscrow(listing);
    } catch (err) {
      this.handleError(err);
    }
  }

  async confirmDeposit(): Promise<void> {
    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    if (this.ensureQuoteLive()) {
      return;
    }

    this.patchState({ step: 'loading' });
    try {
      const response = await api.escrows.deposit(currentEscrow.id, {
        testMode: this.options.testMode ?? true,
      });
      this.escrow = response.escrow;
      this.patchState({ escrow: response.escrow, step: 'uploadReceipt' });
    } catch (err) {
      this.handleError(err);
    }
  }

  async submitReceipt(
    method: 'SINPE' | 'SPEI',
    reference: string,
    receipt?: string,
  ): Promise<void> {
    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    if (this.ensureQuoteLive()) {
      return;
    }

    this.patchState({ step: 'loading' });
    try {
      const response = await api.escrows.reportFiatPayment(currentEscrow.id, {
        method,
        reference,
        receipt,
      });
      this.escrow = response.escrow;
      this.bindEscrowEvents();
      this.patchState({ escrow: response.escrow, step: 'tracking' });
    } catch (err) {
      this.handleError(err);
    }
  }

  retry(): void {
    void this.initialize();
  }

  async forceTestRelease(): Promise<void> {
    if (!this.state.testMode) {
      return;
    }

    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    try {
      await api.test.forceRelease(currentEscrow.id);
    } catch (err) {
      this.handleError(err);
    }
  }

  async forceTestDispute(reason?: string): Promise<void> {
    if (!this.state.testMode) {
      return;
    }

    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    try {
      await api.test.forceDispute(currentEscrow.id, reason ? { reason } : undefined);
    } catch (err) {
      this.handleError(err);
    }
  }

  async forceTestTimeout(): Promise<void> {
    if (!this.state.testMode) {
      return;
    }

    const api = this.api;
    const currentEscrow = this.escrow;
    if (!api || !currentEscrow) {
      return;
    }

    try {
      await api.test.forceTimeout(currentEscrow.id);
    } catch (err) {
      this.handleError(err);
    }
  }

  private getNow(): number {
    return this.options.now?.() ?? Date.now();
  }

  private snapshotScope() {
    return buildCheckoutSnapshotScope({
      publishableKey: this.options.publishableKey,
      listingId: this.options.listingId,
      mode: this.options.mode ?? 'buy',
    });
  }

  private storageKey(): string {
    return checkoutStorageKey(this.snapshotScope());
  }

  private patchState(partial: Partial<CheckoutFlowState>): void {
    if (this.destroyed) {
      return;
    }

    this.state = applyCheckoutTransition(this.state, partial);
    this.options.onChange?.(this.state);
    void this.persistState();
  }

  private handleError(err: unknown): void {
    const normalized = err instanceof Error ? err : new Error(String(err));
    this.patchState({ error: normalized, step: 'error' });
    this.options.onError?.(normalized);
  }

  private handleQuoteExpired(): void {
    const error = new CheckoutQuoteExpiredError(resolveMessages().labels.quoteExpired);
    this.patchState({ error, step: 'error', quote: null });
    this.options.onError?.(error);
  }

  private ensureQuoteLive(): boolean {
    if (!isQuoteExpired(this.state.quote, this.getNow())) {
      return false;
    }

    void this.clearStorage();
    this.handleQuoteExpired();
    return true;
  }

  private async clearStorage(): Promise<void> {
    const storage = this.options.storage;
    if (!storage) {
      return;
    }

    try {
      await Promise.resolve(storage.removeItem(this.storageKey()));
    } catch {
      // Never propagate storage failures to host code.
    }
  }

  private async persistState(): Promise<void> {
    const storage = this.options.storage;
    if (!storage || !this.session) {
      return;
    }

    if (isTerminalCheckoutStep(this.state.step)) {
      await this.clearStorage();
      return;
    }

    if (!isPersistableStep(this.state.step)) {
      return;
    }

    const snapshot: CheckoutSnapshot = {
      version: 1,
      step: this.state.step,
      sessionId: this.state.sessionId ?? this.session.sessionId,
      selectedListing: this.state.selectedListing,
      quote: this.state.quote,
      escrow: this.state.escrow,
      milestones: this.state.milestones,
      testMode: this.state.testMode,
      session: {
        sessionId: this.session.sessionId,
        clientSecret: this.session.clientSecret,
        expiresAt: this.session.expiresAt.toISOString(),
        mode: this.session.mode,
      },
      scope: this.snapshotScope(),
    };

    try {
      await Promise.resolve(
        storage.setItem(this.storageKey(), serializeCheckoutSnapshot(snapshot)),
      );
    } catch {
      // Never propagate storage failures to host code.
    }
  }

  private async tryHydrate(): Promise<boolean> {
    const storage = this.options.storage;
    if (!storage) {
      return false;
    }

    let raw: string | null = null;
    try {
      raw = await Promise.resolve(storage.getItem(this.storageKey()));
    } catch {
      return false;
    }

    if (!raw) {
      return false;
    }

    const snapshot = parseCheckoutSnapshot(raw);
    if (!snapshot || !snapshotMatchesScope(snapshot, this.snapshotScope())) {
      await this.clearStorage();
      return false;
    }

    if (isCheckoutSnapshotExpired(snapshot, this.getNow())) {
      await this.clearStorage();
      this.state = createInitialCheckoutState(isTestMode(this.options.publishableKey));
      this.handleQuoteExpired();
      return true;
    }

    try {
      const client = Pacto.init({
        publishableKey: this.options.publishableKey,
        gatewayUrl: this.options.gatewayUrl,
        ...this.options.resilience,
      });
      this.client = client;

      const sessionData: PactoSessionData = {
        sessionId: snapshot.session.sessionId,
        clientSecret: snapshot.session.clientSecret,
        expiresAt: new Date(snapshot.session.expiresAt),
        mode: snapshot.session.mode,
      };

      const session = client.resumeCheckoutSession(sessionData);
      if (session.isExpired()) {
        await this.clearStorage();
        this.state = createInitialCheckoutState(isTestMode(this.options.publishableKey));
        this.handleQuoteExpired();
        return true;
      }

      this.session = session;
      this.api = client.api(session);
      this.escrow = snapshot.escrow;
      this.eventsBound = false;

      this.state = {
        step: snapshot.step,
        sessionId: snapshot.sessionId,
        listings: [],
        selectedListing: snapshot.selectedListing,
        escrow: snapshot.escrow,
        quote: snapshot.quote,
        error: null,
        milestones: snapshot.milestones,
        testMode: snapshot.testMode,
      };

      if (snapshot.step === 'tracking' || snapshot.step === 'disputed') {
        this.bindEscrowEvents();
      }

      this.options.onChange?.(this.state);
      return true;
    } catch {
      await this.clearStorage();
      return false;
    }
  }

  private bindEscrowEvents(): void {
    const session = this.session;
    const currentEscrow = this.escrow;
    if (!session || !currentEscrow || this.eventsBound) {
      return;
    }

    this.eventsBound = true;
    const escrowId = currentEscrow.id;

    // Surfaces breaker-open, retry-exhausted, and other terminal escrow
    // stream failures instead of leaving milestone tracking silently stuck.
    session.onStreamError((error) => this.handleError(error));

    const trackMilestone = (event: EscrowEvent) => {
      this.patchState({ milestones: [...this.state.milestones, event] });
    };

    session.on(
      'released',
      (event) => {
        trackMilestone(event);
        this.patchState({ step: 'success' });
        this.options.onComplete?.(currentEscrow);
      },
      { escrowId },
    );

    session.on(
      'disputed',
      (event) => {
        trackMilestone(event);
        this.patchState({ step: 'disputed' });
        this.options.onDispute?.(currentEscrow);
      },
      { escrowId },
    );

    session.on(
      'refunded',
      (event) => {
        trackMilestone(event);
        this.patchState({ step: 'refunded' });
        this.options.onRefund?.(currentEscrow);
      },
      { escrowId },
    );

    session.on(
      'dispute.resolved',
      (event) => {
        trackMilestone(event);
        const outcome =
          event.data && typeof event.data === 'object' && 'outcome' in event.data
            ? (event.data as { outcome?: string }).outcome
            : undefined;
        if (outcome === 'refund') {
          this.patchState({ step: 'refunded' });
          this.options.onRefund?.(currentEscrow);
        } else {
          this.patchState({ step: 'success' });
          this.options.onComplete?.(currentEscrow);
        }
      },
      { escrowId },
    );

    session.on('escrow.funded', trackMilestone, { escrowId });
    session.on('fiat.reported', trackMilestone, { escrowId });
  }

  private async createQuoteAndEscrow(listing: Listing): Promise<void> {
    const api = this.api;
    if (!api) {
      throw new Error('API client not initialized');
    }

    const quoteResponse = await api.quotes.create({
      listingId: listing.id,
      asset: listing.asset,
      amount: listing.amount,
      price: listing.price,
      side: 'buy',
    });

    const escrowResponse = await api.escrows.create({ quoteId: quoteResponse.quote.id });
    this.escrow = escrowResponse.escrow;
    this.patchState({
      quote: quoteResponse.quote,
      escrow: escrowResponse.escrow,
      step: 'deposit',
    });
  }

  private async initialize(): Promise<void> {
    await this.clearStorage();

    this.state = createInitialCheckoutState(isTestMode(this.options.publishableKey));
    this.eventsBound = false;
    this.escrow = null;
    this.session?.closeEvents();
    this.session = null;
    this.api = null;
    this.options.onChange?.(this.state);

    try {
      const client = Pacto.init({
        publishableKey: this.options.publishableKey,
        gatewayUrl: this.options.gatewayUrl,
        ...this.options.resilience,
      });
      this.client = client;

      const mode = this.options.mode ?? 'buy';
      const session = this.options.session
        ? client.resumeCheckoutSession(this.options.session)
        : this.options.listingId
          ? await client.createCheckoutSession({ listingId: this.options.listingId, mode })
          : await client.createCheckoutSession({ quote: { browse: true }, mode });

      this.session = session;
      this.api = client.api(session);
      this.patchState({ sessionId: session.sessionId });

      if (this.options.listingId) {
        const listingResponse = await this.api.listings.retrieve(this.options.listingId);
        this.patchState({ selectedListing: listingResponse.listing });
        await this.createQuoteAndEscrow(listingResponse.listing);
        return;
      }

      const listingsResponse = await this.api.listings.list();
      this.patchState({ listings: listingsResponse.listings, step: 'selectListing' });
    } catch (err) {
      this.handleError(err);
    }
  }
}

export { createInitialCheckoutState } from './checkout-machine.js';
