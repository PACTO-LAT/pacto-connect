export type EscrowStatus =
  | 'pending'
  | 'funded'
  | 'released'
  | 'disputed'
  | 'cancelled'
  | 'refunded';

export type EscrowAction =
  | { type: 'cancel' }
  | { type: 'deposit' }
  | { type: 'report_fiat'; fiatReported: boolean }
  | { type: 'release' }
  | { type: 'refund'; amount: number; remaining: number }
  | { type: 'open_dispute' }
  | { type: 'resolve_dispute'; outcome: 'release' | 'refund' };

export type TransitionResult =
  | { ok: true; nextStatus: EscrowStatus }
  | { ok: false; code: string; message: string };

export function assertTransition(status: EscrowStatus, action: EscrowAction): TransitionResult {
  switch (action.type) {
    case 'cancel':
      if (status !== 'pending') {
        return {
          ok: false,
          code: 'invalid_transition',
          message: `Cannot cancel escrow in status ${status}`,
        };
      }
      return { ok: true, nextStatus: 'cancelled' };

    case 'deposit':
      if (status !== 'pending') {
        return {
          ok: false,
          code: 'invalid_transition',
          message: `Cannot deposit escrow in status ${status}`,
        };
      }
      return { ok: true, nextStatus: 'funded' };

    case 'report_fiat':
      if (status !== 'funded') {
        return {
          ok: false,
          code: 'invalid_transition',
          message: `Cannot report fiat for escrow in status ${status}`,
        };
      }
      if (action.fiatReported) {
        return {
          ok: false,
          code: 'invalid_transition',
          message: 'Fiat payment already reported for this escrow',
        };
      }
      return { ok: true, nextStatus: 'funded' };

    case 'release':
      if (status !== 'funded') {
        return {
          ok: false,
          code: 'invalid_transition',
          message: `Cannot release escrow in status ${status}`,
        };
      }
      return { ok: true, nextStatus: 'released' };

    case 'refund':
      if (status !== 'released') {
        return {
          ok: false,
          code: 'invalid_transition',
          message: `Cannot refund escrow in status ${status}`,
        };
      }
      if (action.amount <= 0) {
        return {
          ok: false,
          code: 'refund_exceeds_balance',
          message: 'Refund amount must be greater than zero',
        };
      }
      if (action.amount > action.remaining) {
        return {
          ok: false,
          code: 'refund_exceeds_balance',
          message: 'Refund amount exceeds remaining escrow balance',
        };
      }
      return {
        ok: true,
        nextStatus: action.amount >= action.remaining ? 'refunded' : 'released',
      };

    case 'open_dispute':
      if (status !== 'funded' && status !== 'released') {
        return {
          ok: false,
          code: 'invalid_transition',
          message: `Cannot open dispute for escrow in status ${status}`,
        };
      }
      return { ok: true, nextStatus: 'disputed' };

    case 'resolve_dispute':
      if (status !== 'disputed') {
        return {
          ok: false,
          code: 'invalid_transition',
          message: `Cannot resolve dispute for escrow in status ${status}`,
        };
      }
      return {
        ok: true,
        nextStatus: action.outcome === 'refund' ? 'refunded' : 'released',
      };

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export const TERMINAL_ESCROW_STATUSES: EscrowStatus[] = ['cancelled', 'refunded'];

export function isTerminalStatus(status: EscrowStatus): boolean {
  return TERMINAL_ESCROW_STATUSES.includes(status);
}
