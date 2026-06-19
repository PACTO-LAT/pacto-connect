import {
  type CheckoutMode,
  type Escrow,
  type EscrowEvent,
  type Listing,
  Pacto,
  type PactoApiClient,
  type PactoClient,
  type PactoSession,
  type Quote,
} from '@pacto-connect/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export type CheckoutStep =
  | 'loading'
  | 'selectListing'
  | 'deposit'
  | 'uploadReceipt'
  | 'tracking'
  | 'success'
  | 'disputed'
  | 'error';

export interface UseCheckoutFlowOptions {
  publishableKey: string;
  gatewayUrl?: string;
  listingId?: string;
  mode?: CheckoutMode;
  testMode?: boolean;
  enabled: boolean;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onError?: (error: Error) => void;
}

export interface UseCheckoutFlowResult {
  step: CheckoutStep;
  listings: Listing[];
  selectedListing: Listing | null;
  escrow: Escrow | null;
  quote: Quote | null;
  error: Error | null;
  milestones: EscrowEvent[];
  selectListing: (listing: Listing) => Promise<void>;
  confirmDeposit: () => Promise<void>;
  submitReceipt: (method: 'SINPE' | 'SPEI', reference: string, receipt?: string) => Promise<void>;
  retry: () => void;
}

export function useCheckoutFlow(options: UseCheckoutFlowOptions): UseCheckoutFlowResult {
  const [step, setStep] = useState<CheckoutStep>('loading');
  const [listings, setListings] = useState<Listing[]>([]);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [milestones, setMilestones] = useState<EscrowEvent[]>([]);

  const sessionRef = useRef<PactoSession | null>(null);
  const clientRef = useRef<PactoClient | null>(null);
  const apiRef = useRef<PactoApiClient | null>(null);
  const escrowRef = useRef<Escrow | null>(null);
  const eventsBoundRef = useRef(false);

  const onCompleteRef = useRef(options.onComplete);
  const onDisputeRef = useRef(options.onDispute);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onCompleteRef.current = options.onComplete;
    onDisputeRef.current = options.onDispute;
    onErrorRef.current = options.onError;
  });

  const handleError = useCallback((err: unknown) => {
    const normalized = err instanceof Error ? err : new Error(String(err));
    setError(normalized);
    setStep('error');
    onErrorRef.current?.(normalized);
  }, []);

  const bindEscrowEvents = useCallback(() => {
    const session = sessionRef.current;
    const currentEscrow = escrowRef.current;
    if (!session || !currentEscrow || eventsBoundRef.current) {
      return;
    }

    eventsBoundRef.current = true;
    const escrowId = currentEscrow.id;

    const trackMilestone = (event: EscrowEvent) => {
      setMilestones((prev) => [...prev, event]);
    };

    session.on(
      'released',
      (event) => {
        trackMilestone(event);
        setStep('success');
        onCompleteRef.current?.(currentEscrow);
      },
      { escrowId },
    );

    session.on(
      'disputed',
      (event) => {
        trackMilestone(event);
        setStep('disputed');
        onDisputeRef.current?.(currentEscrow);
      },
      { escrowId },
    );

    session.on('escrow.funded', trackMilestone, { escrowId });
    session.on('fiat.reported', trackMilestone, { escrowId });
  }, []);

  const createQuoteAndEscrow = useCallback(async (listing: Listing) => {
    const api = apiRef.current;
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
    setQuote(quoteResponse.quote);

    const escrowResponse = await api.escrows.create({ quoteId: quoteResponse.quote.id });
    setEscrow(escrowResponse.escrow);
    escrowRef.current = escrowResponse.escrow;
    setStep('deposit');
  }, []);

  const initialize = useCallback(async () => {
    setStep('loading');
    setError(null);
    setMilestones([]);
    eventsBoundRef.current = false;

    try {
      const client = Pacto.init({
        publishableKey: options.publishableKey,
        gatewayUrl: options.gatewayUrl,
      });
      clientRef.current = client;

      const mode = options.mode ?? 'buy';
      const session = options.listingId
        ? await client.createCheckoutSession({ listingId: options.listingId, mode })
        : await client.createCheckoutSession({ quote: { browse: true }, mode });

      sessionRef.current = session;
      const api = client.api(session);
      apiRef.current = api;

      if (options.listingId) {
        const listingResponse = await api.listings.retrieve(options.listingId);
        setSelectedListing(listingResponse.listing);
        await createQuoteAndEscrow(listingResponse.listing);
        return;
      }

      const listingsResponse = await api.listings.list();
      setListings(listingsResponse.listings);
      setStep('selectListing');
    } catch (err) {
      handleError(err);
    }
  }, [
    createQuoteAndEscrow,
    handleError,
    options.gatewayUrl,
    options.listingId,
    options.mode,
    options.publishableKey,
  ]);

  const selectListing = useCallback(
    async (listing: Listing) => {
      setSelectedListing(listing);
      setStep('loading');
      try {
        await createQuoteAndEscrow(listing);
      } catch (err) {
        handleError(err);
      }
    },
    [createQuoteAndEscrow, handleError],
  );

  const confirmDeposit = useCallback(async () => {
    const api = apiRef.current;
    const currentEscrow = escrowRef.current;
    if (!api || !currentEscrow) {
      return;
    }

    setStep('loading');
    try {
      const response = await api.escrows.deposit(currentEscrow.id, {
        testMode: options.testMode ?? true,
      });
      setEscrow(response.escrow);
      escrowRef.current = response.escrow;
      setStep('uploadReceipt');
    } catch (err) {
      handleError(err);
    }
  }, [handleError, options.testMode]);

  const submitReceipt = useCallback(
    async (method: 'SINPE' | 'SPEI', reference: string, receipt?: string) => {
      const api = apiRef.current;
      const currentEscrow = escrowRef.current;
      if (!api || !currentEscrow) {
        return;
      }

      setStep('loading');
      try {
        const response = await api.escrows.reportFiatPayment(currentEscrow.id, {
          method,
          reference,
          receipt,
        });
        setEscrow(response.escrow);
        escrowRef.current = response.escrow;
        bindEscrowEvents();
        setStep('tracking');
      } catch (err) {
        handleError(err);
      }
    },
    [bindEscrowEvents, handleError],
  );

  const retry = useCallback(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    initialize();

    return () => {
      sessionRef.current?.closeEvents();
      sessionRef.current = null;
      clientRef.current = null;
      apiRef.current = null;
      escrowRef.current = null;
      eventsBoundRef.current = false;
    };
  }, [initialize, options.enabled]);

  return {
    step,
    listings,
    selectedListing,
    escrow,
    quote,
    error,
    milestones,
    selectListing,
    confirmDeposit,
    submitReceipt,
    retry,
  };
}
