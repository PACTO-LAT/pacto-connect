import type { PactoMessages } from '../types.js';

/** Canonical dictionary. Every other catalogue must carry the same key set (see parity.ts). */
export const en: PactoMessages = {
  steps: {
    loading: 'Processing checkout',
    selectListing: 'Select a listing',
    deposit: 'Deposit to escrow',
    uploadReceipt: 'Upload payment receipt',
    tracking: 'Tracking escrow status',
    success: 'Payment complete',
    disputed: 'Escrow disputed',
    error: 'Checkout error',
  },
  milestones: {
    'escrow.funded': 'Escrow funded',
    'fiat.reported': 'Fiat payment reported',
    released: 'Funds released',
    disputed: 'Escrow disputed',
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
  },
};
