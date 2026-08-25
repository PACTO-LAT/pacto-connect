import { randomUUID } from 'node:crypto';
import type { EscrowEventName, EscrowMilestone } from '@pacto-connect/core';
import { assertTransition, type EscrowStatus } from '../escrow/transitions.js';

export type { EscrowStatus };

export type SimulatorErrorCode =
  | 'escrow_not_found'
  | 'invalid_transition'
  | 'refund_exceeds_balance'
  | 'dispute_not_found';

export class SimulatorError extends Error {
  constructor(
    public readonly code: SimulatorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SimulatorError';
  }
}

function transitionOrThrow(
  status: EscrowStatus,
  action: Parameters<typeof assertTransition>[1],
): EscrowStatus {
  const result = assertTransition(status, action);
  if (!result.ok) {
    throw new SimulatorError(result.code as SimulatorErrorCode, result.message);
  }
  return result.nextStatus;
}

const MILESTONE_BY_EVENT: Record<EscrowEventName, EscrowMilestone> = {
  'escrow.funded': 'funded',
  'fiat.reported': 'fiat_reported',
  released: 'released',
  disputed: 'disputed',
  cancelled: 'cancelled',
  refunded: 'refunded',
  'dispute.resolved': 'dispute_resolved',
};

export type SettlementSink = (settlement: {
  merchantId: string;
  escrowId: string;
  amount: number;
  asset: string;
}) => void;

let settlementSink: SettlementSink | null = null;

export function setSettlementSink(sink: SettlementSink | null): void {
  settlementSink = sink;
}

export interface SimulatorEscrow {
  id: string;
  quoteId: string;
  apiKeyId: string;
  sessionId: string;
  status: EscrowStatus;
  amount: string;
  asset: string;
  refundedAmount: string;
  remainingAmount: string;
  createdAt: string;
  updatedAt: string;
  merchantId?: string;
  openDisputeId?: string;
}

export interface SimulatorEvent {
  cursor: string;
  type: EscrowEventName;
  escrowId: string;
  milestone: EscrowMilestone;
  occurredAt: string;
  data?: Record<string, unknown>;
}

export interface SimulatorRefund {
  id: string;
  escrowId: string;
  amount: string;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface SimulatorDispute {
  id: string;
  escrowId: string;
  status: 'open' | 'resolved';
  reason: string;
  actor: string;
  evidenceRefs: string[];
  resolution?: 'release' | 'refund';
  resolvedAt?: string;
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
}

type EventListener = (event: SimulatorEvent) => void;

interface EscrowRecord {
  id: string;
  quoteId: string;
  apiKeyId: string;
  sessionId: string;
  status: EscrowStatus;
  amount: string;
  asset: string;
  refundedAmount: number;
  createdAt: string;
  updatedAt: string;
  fiatReported: boolean;
  releaseTimer?: ReturnType<typeof setTimeout>;
  merchantId?: string;
  openDisputeId?: string;
}

interface DisputeRecord {
  id: string;
  escrowId: string;
  status: 'open' | 'resolved';
  reason: string;
  actor: string;
  evidenceRefs: string[];
  resolution?: 'release' | 'refund';
  resolvedAt?: string;
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
}

function getReleaseDelayMs(): number {
  const configured = process.env.TESTMODE_RELEASE_DELAY_MS;
  if (!configured) {
    return 3000;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 3000;
  }

  return parsed;
}

function escrowKey(apiKeyId: string, sessionId: string, escrowId: string): string {
  return `${apiKeyId}:${sessionId}:${escrowId}`;
}

function formatAmount(value: number): string {
  return String(value);
}

function toPublicEscrow(record: EscrowRecord): SimulatorEscrow {
  const principal = Number(record.amount);
  const remaining = Math.max(0, principal - record.refundedAmount);
  return {
    id: record.id,
    quoteId: record.quoteId,
    apiKeyId: record.apiKeyId,
    sessionId: record.sessionId,
    status: record.status,
    amount: record.amount,
    asset: record.asset,
    refundedAmount: formatAmount(record.refundedAmount),
    remainingAmount: formatAmount(remaining),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    merchantId: record.merchantId,
    openDisputeId: record.openDisputeId,
  };
}

function toPublicDispute(record: DisputeRecord): SimulatorDispute {
  return { ...record };
}

class EscrowSimulator {
  private escrows = new Map<string, EscrowRecord>();
  private disputes = new Map<string, DisputeRecord>();
  private refunds: SimulatorRefund[] = [];
  private events: SimulatorEvent[] = [];
  private eventCounter = 0;
  private listeners = new Set<{
    sessionId: string;
    escrowId?: string;
    listener: EventListener;
  }>();

  reset(): void {
    for (const record of this.escrows.values()) {
      if (record.releaseTimer) {
        clearTimeout(record.releaseTimer);
      }
    }

    this.escrows.clear();
    this.disputes.clear();
    this.refunds = [];
    this.events = [];
    this.eventCounter = 0;
    this.listeners.clear();
  }

  subscribe(sessionId: string, escrowId: string | undefined, listener: EventListener): () => void {
    const entry = { sessionId, escrowId, listener };
    this.listeners.add(entry);

    return () => {
      this.listeners.delete(entry);
    };
  }

  createEscrow(input: {
    apiKeyId: string;
    sessionId: string;
    quoteId: string;
    amount: string;
    asset: string;
    merchantId?: string;
  }): SimulatorEscrow {
    const now = new Date().toISOString();
    const id = `esc_${randomUUID()}`;
    const record: EscrowRecord = {
      id,
      quoteId: input.quoteId,
      apiKeyId: input.apiKeyId,
      sessionId: input.sessionId,
      status: 'pending',
      amount: input.amount,
      asset: input.asset,
      refundedAmount: 0,
      createdAt: now,
      updatedAt: now,
      fiatReported: false,
      merchantId: input.merchantId,
    };

    this.escrows.set(escrowKey(input.apiKeyId, input.sessionId, id), record);
    return toPublicEscrow(record);
  }

  getEscrow(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    return toPublicEscrow(record);
  }

  getStatus(sessionId: string, id: string, apiKeyId?: string): EscrowStatus {
    return this.findEscrow(sessionId, id, apiKeyId).status;
  }

  getDispute(disputeId: string): SimulatorDispute | undefined {
    const record = this.disputes.get(disputeId);
    return record ? toPublicDispute(record) : undefined;
  }

  deposit(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    record.status = transitionOrThrow(record.status, { type: 'deposit' });
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'escrow.funded');
    return toPublicEscrow(record);
  }

  reportFiat(
    sessionId: string,
    id: string,
    input: { method: string; reference: string; receipt?: string },
    apiKeyId?: string,
  ): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    record.status = transitionOrThrow(record.status, {
      type: 'report_fiat',
      fiatReported: record.fiatReported,
    });

    record.fiatReported = true;
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'fiat.reported', {
      method: input.method,
      reference: input.reference,
      ...(input.receipt !== undefined ? { receipt: input.receipt } : {}),
    });

    this.scheduleRelease(record);
    return toPublicEscrow(record);
  }

  cancel(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    record.status = transitionOrThrow(record.status, { type: 'cancel' });
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'cancelled');
    return toPublicEscrow(record);
  }

  refund(
    sessionId: string,
    id: string,
    input: { amount: number; reason: string; actor: string },
    apiKeyId?: string,
  ): { escrow: SimulatorEscrow; refund: SimulatorRefund } {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    const principal = Number(record.amount);
    const remaining = principal - record.refundedAmount;

    record.status = transitionOrThrow(record.status, {
      type: 'refund',
      amount: input.amount,
      remaining,
    });

    record.refundedAmount += input.amount;
    record.updatedAt = new Date().toISOString();

    const refund: SimulatorRefund = {
      id: `rfd_${randomUUID()}`,
      escrowId: record.id,
      amount: formatAmount(input.amount),
      reason: input.reason,
      actor: input.actor,
      createdAt: new Date().toISOString(),
    };
    this.refunds.push(refund);
    this.emitEvent(record, 'refunded', {
      refundId: refund.id,
      amount: refund.amount,
      reason: refund.reason,
    });

    return { escrow: toPublicEscrow(record), refund };
  }

  openDispute(
    sessionId: string,
    id: string,
    input: {
      reason: string;
      actor: string;
      evidenceRefs?: string[];
    },
    apiKeyId?: string,
  ): { escrow: SimulatorEscrow; dispute: SimulatorDispute } {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    this.cancelReleaseTimer(record);
    record.status = transitionOrThrow(record.status, { type: 'open_dispute' });
    record.updatedAt = new Date().toISOString();

    const now = new Date().toISOString();
    const disputeRecord: DisputeRecord = {
      id: `dsp_${randomUUID()}`,
      escrowId: record.id,
      status: 'open',
      reason: input.reason,
      actor: input.actor,
      evidenceRefs: input.evidenceRefs ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.disputes.set(disputeRecord.id, disputeRecord);
    record.openDisputeId = disputeRecord.id;

    this.emitEvent(record, 'disputed', {
      disputeId: disputeRecord.id,
      reason: input.reason,
      actor: input.actor,
    });

    return { escrow: toPublicEscrow(record), dispute: toPublicDispute(disputeRecord) };
  }

  resolveDispute(
    sessionId: string,
    id: string,
    disputeId: string,
    input: { outcome: 'release' | 'refund'; note?: string },
    apiKeyId?: string,
  ): { escrow: SimulatorEscrow; dispute: SimulatorDispute } {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    const disputeRecord = this.disputes.get(disputeId);
    if (!disputeRecord || disputeRecord.escrowId !== record.id) {
      throw new SimulatorError('dispute_not_found', `Dispute ${disputeId} not found`);
    }
    if (disputeRecord.status !== 'open') {
      throw new SimulatorError('invalid_transition', 'Dispute is already resolved');
    }

    record.status = transitionOrThrow(record.status, {
      type: 'resolve_dispute',
      outcome: input.outcome,
    });
    record.updatedAt = new Date().toISOString();
    record.openDisputeId = undefined;

    if (input.outcome === 'refund') {
      const principal = Number(record.amount);
      record.refundedAmount = principal;
    }

    const now = new Date().toISOString();
    disputeRecord.status = 'resolved';
    disputeRecord.resolution = input.outcome;
    disputeRecord.resolvedAt = now;
    disputeRecord.resolutionNote = input.note;
    disputeRecord.updatedAt = now;

    this.emitEvent(record, 'dispute.resolved', {
      disputeId,
      outcome: input.outcome,
      ...(input.note ? { note: input.note } : {}),
    });

    return { escrow: toPublicEscrow(record), dispute: toPublicDispute(disputeRecord) };
  }

  forceRelease(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    const record = this.findEscrow(sessionId, id, apiKeyId);
    this.cancelReleaseTimer(record);
    record.status = transitionOrThrow(record.status, { type: 'release' });
    record.updatedAt = new Date().toISOString();
    this.emitEvent(record, 'released');
    this.recordSettlement(record);
    return toPublicEscrow(record);
  }

  forceDispute(sessionId: string, id: string, reason?: string, apiKeyId?: string): SimulatorEscrow {
    return this.openDispute(
      sessionId,
      id,
      { reason: reason ?? 'manual', actor: 'system', evidenceRefs: [] },
      apiKeyId,
    ).escrow;
  }

  forceTimeout(sessionId: string, id: string, apiKeyId?: string): SimulatorEscrow {
    return this.openDispute(
      sessionId,
      id,
      { reason: 'timeout', actor: 'system', evidenceRefs: [] },
      apiKeyId,
    ).escrow;
  }

  getEventsSince(
    sessionId: string,
    escrowId: string | undefined,
    cursor: string | undefined,
    apiKeyId?: string,
  ): SimulatorEvent[] {
    return this.events.filter((event) => {
      const record = this.findEscrowById(event.escrowId);
      if (!record || record.sessionId !== sessionId) {
        return false;
      }

      if (apiKeyId && record.apiKeyId !== apiKeyId) {
        return false;
      }

      if (escrowId && event.escrowId !== escrowId) {
        return false;
      }

      if (cursor && event.cursor <= cursor) {
        return false;
      }

      return true;
    });
  }

  private findEscrowById(escrowId: string): EscrowRecord | undefined {
    for (const record of this.escrows.values()) {
      if (record.id === escrowId) {
        return record;
      }
    }

    return undefined;
  }

  private findEscrow(sessionId: string, id: string, apiKeyId?: string): EscrowRecord {
    for (const record of this.escrows.values()) {
      if (record.id !== id || record.sessionId !== sessionId) {
        continue;
      }

      if (apiKeyId && record.apiKeyId !== apiKeyId) {
        continue;
      }

      return record;
    }

    throw new SimulatorError('escrow_not_found', `Escrow ${id} not found`);
  }

  private nextCursor(): string {
    this.eventCounter += 1;
    return `evt_${String(this.eventCounter).padStart(6, '0')}`;
  }

  private emitEvent(
    record: EscrowRecord,
    type: EscrowEventName,
    data?: Record<string, unknown>,
  ): SimulatorEvent {
    const event: SimulatorEvent = {
      cursor: this.nextCursor(),
      type,
      escrowId: record.id,
      milestone: MILESTONE_BY_EVENT[type],
      occurredAt: new Date().toISOString(),
      ...(data ? { data } : {}),
    };

    this.events.push(event);

    for (const entry of this.listeners) {
      if (entry.sessionId !== record.sessionId) {
        continue;
      }

      if (entry.escrowId && entry.escrowId !== event.escrowId) {
        continue;
      }

      entry.listener(event);
    }

    return event;
  }

  private recordSettlement(record: EscrowRecord): void {
    if (!record.merchantId || !settlementSink) {
      return;
    }
    const amount = Number(record.amount);
    if (!Number.isFinite(amount)) {
      return;
    }
    settlementSink({
      merchantId: record.merchantId,
      escrowId: record.id,
      amount,
      asset: record.asset,
    });
  }

  private cancelReleaseTimer(record: EscrowRecord): void {
    if (record.releaseTimer) {
      clearTimeout(record.releaseTimer);
      record.releaseTimer = undefined;
    }
  }

  private scheduleRelease(record: EscrowRecord): void {
    this.cancelReleaseTimer(record);

    record.releaseTimer = setTimeout(() => {
      record.releaseTimer = undefined;

      if (record.status !== 'funded') {
        return;
      }

      record.status = 'released';
      record.updatedAt = new Date().toISOString();
      this.emitEvent(record, 'released');
      this.recordSettlement(record);
    }, getReleaseDelayMs());
  }
}

let simulatorInstance: EscrowSimulator | undefined;

export function getSimulator(): EscrowSimulator {
  if (!simulatorInstance) {
    simulatorInstance = new EscrowSimulator();
  }

  return simulatorInstance;
}

export function resetSimulator(): void {
  if (simulatorInstance) {
    simulatorInstance.reset();
  }
}
