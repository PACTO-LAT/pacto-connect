import type { EscrowActor, EscrowDispute, EscrowRefund } from '@prisma/client';
import { prisma } from '../db.js';
import {
  getSimulator,
  type SimulatorDispute,
  SimulatorError,
  type SimulatorEscrow,
} from '../testmode/simulator.js';
import {
  emitDisputeOpened,
  emitDisputeResolved,
  emitEscrowCancelled,
  emitEscrowRefunded,
} from '../webhooks/events.js';

export { SimulatorError };

export interface LifecycleResult<T> {
  data: T;
  transitioned: boolean;
}

function mapActor(value: string): EscrowActor {
  if (
    value === 'buyer' ||
    value === 'seller' ||
    value === 'merchant' ||
    value === 'admin' ||
    value === 'system'
  ) {
    return value;
  }
  return 'system';
}

async function ensureEscrowRecord(simEscrow: SimulatorEscrow): Promise<void> {
  await prisma.escrow.upsert({
    where: { id: simEscrow.id },
    create: {
      id: simEscrow.id,
      apiKeyId: simEscrow.apiKeyId,
      sessionId: simEscrow.sessionId,
      quoteId: simEscrow.quoteId,
      status: simEscrow.status,
      amount: Number(simEscrow.amount),
      asset: simEscrow.asset,
      merchantId: simEscrow.merchantId ?? null,
    },
    update: {
      status: simEscrow.status,
      updatedAt: new Date(),
    },
  });
}

function serializeDispute(dispute: SimulatorDispute): EscrowDispute {
  return {
    id: dispute.id,
    escrowId: dispute.escrowId,
    status: dispute.status,
    reason: dispute.reason,
    actor: mapActor(dispute.actor),
    evidenceRefs: dispute.evidenceRefs,
    resolution: dispute.resolution ?? null,
    resolvedBy: dispute.resolution ? 'admin' : null,
    resolvedAt: dispute.resolvedAt ? new Date(dispute.resolvedAt) : null,
    resolutionNote: dispute.resolutionNote ?? null,
    createdAt: new Date(dispute.createdAt),
    updatedAt: new Date(dispute.updatedAt),
  } as EscrowDispute;
}

export async function cancelEscrow(input: {
  sessionId: string;
  escrowId: string;
  apiKeyId: string;
  reason?: string;
}): Promise<LifecycleResult<{ escrow: SimulatorEscrow }> | null> {
  const simulator = getSimulator();
  let simEscrow: SimulatorEscrow;
  try {
    simEscrow = simulator.getEscrow(input.sessionId, input.escrowId, input.apiKeyId);
  } catch (error) {
    if (error instanceof SimulatorError && error.code === 'escrow_not_found') {
      return null;
    }
    throw error;
  }

  if (simEscrow.status === 'cancelled') {
    return { data: { escrow: simEscrow }, transitioned: false };
  }

  const updated = simulator.cancel(input.sessionId, input.escrowId, input.apiKeyId);
  await ensureEscrowRecord(updated);
  await prisma.escrow.update({
    where: { id: updated.id },
    data: {
      status: 'cancelled',
      cancelReason: input.reason ?? null,
      cancelledAt: new Date(),
      cancelledBy: 'merchant',
    },
  });

  await emitEscrowCancelled(
    input.apiKeyId,
    { escrowId: updated.id, reason: input.reason ?? null },
    updated.merchantId,
  );

  return { data: { escrow: updated }, transitioned: true };
}

export async function refundEscrow(input: {
  sessionId: string;
  escrowId: string;
  apiKeyId: string;
  amount: number;
  reason: string;
  actor?: string;
}): Promise<LifecycleResult<{ escrow: SimulatorEscrow; refund: EscrowRefund }> | null> {
  const simulator = getSimulator();
  try {
    simulator.getEscrow(input.sessionId, input.escrowId, input.apiKeyId);
  } catch (error) {
    if (error instanceof SimulatorError && error.code === 'escrow_not_found') {
      return null;
    }
    throw error;
  }

  const { escrow, refund } = simulator.refund(
    input.sessionId,
    input.escrowId,
    {
      amount: input.amount,
      reason: input.reason,
      actor: input.actor ?? 'merchant',
    },
    input.apiKeyId,
  );

  await ensureEscrowRecord(escrow);
  const dbRefund = await prisma.escrowRefund.create({
    data: {
      id: refund.id,
      escrowId: refund.escrowId,
      amount: Number(refund.amount),
      reason: refund.reason,
      actor: mapActor(refund.actor),
    },
  });
  await prisma.escrow.update({
    where: { id: escrow.id },
    data: { status: escrow.status },
  });

  await emitEscrowRefunded(
    input.apiKeyId,
    {
      escrowId: escrow.id,
      refundId: dbRefund.id,
      amount: dbRefund.amount,
      reason: dbRefund.reason,
      status: escrow.status,
    },
    escrow.merchantId,
  );

  return { data: { escrow, refund: dbRefund }, transitioned: true };
}

export async function openDisputeEscrow(input: {
  sessionId: string;
  escrowId: string;
  apiKeyId: string;
  actor: 'buyer' | 'seller' | 'system';
  reason: string;
  evidenceRefs?: string[];
}): Promise<LifecycleResult<{ escrow: SimulatorEscrow; dispute: EscrowDispute }> | null> {
  const simulator = getSimulator();
  try {
    const existing = simulator.getEscrow(input.sessionId, input.escrowId, input.apiKeyId);
    if (existing.status === 'disputed' && existing.openDisputeId) {
      const dispute = simulator.getDispute(existing.openDisputeId);
      if (dispute) {
        return {
          data: { escrow: existing, dispute: serializeDispute(dispute) },
          transitioned: false,
        };
      }
    }
  } catch (error) {
    if (error instanceof SimulatorError && error.code === 'escrow_not_found') {
      return null;
    }
    throw error;
  }

  const { escrow, dispute } = simulator.openDispute(
    input.sessionId,
    input.escrowId,
    {
      reason: input.reason,
      actor: input.actor,
      evidenceRefs: input.evidenceRefs,
    },
    input.apiKeyId,
  );

  await ensureEscrowRecord(escrow);
  const dbDispute = await prisma.escrowDispute.create({
    data: {
      id: dispute.id,
      escrowId: dispute.escrowId,
      reason: dispute.reason,
      actor: mapActor(dispute.actor),
      evidenceRefs: dispute.evidenceRefs,
    },
  });
  await prisma.escrow.update({
    where: { id: escrow.id },
    data: { status: 'disputed' },
  });

  await emitDisputeOpened(
    input.apiKeyId,
    {
      escrowId: escrow.id,
      disputeId: dbDispute.id,
      reason: dbDispute.reason,
      actor: dbDispute.actor,
    },
    escrow.merchantId,
  );

  return { data: { escrow, dispute: dbDispute }, transitioned: true };
}

export async function resolveDisputeEscrow(input: {
  escrowId: string;
  disputeId: string;
  apiKeyId: string;
  outcome: 'release' | 'refund';
  note?: string;
}): Promise<LifecycleResult<{ escrow: SimulatorEscrow; dispute: EscrowDispute }> | null> {
  const simulator = getSimulator();
  const dbEscrow = await prisma.escrow.findFirst({
    where: { id: input.escrowId, apiKeyId: input.apiKeyId },
  });
  if (!dbEscrow) {
    return null;
  }

  const existingDispute = await prisma.escrowDispute.findFirst({
    where: { id: input.disputeId, escrowId: input.escrowId },
  });
  if (!existingDispute) {
    throw new SimulatorError('dispute_not_found', `Dispute ${input.disputeId} not found`);
  }

  if (existingDispute.status === 'resolved') {
    const simEscrow = simulator.getEscrow(dbEscrow.sessionId, input.escrowId, input.apiKeyId);
    return {
      data: { escrow: simEscrow, dispute: existingDispute },
      transitioned: false,
    };
  }

  const { escrow, dispute } = simulator.resolveDispute(
    dbEscrow.sessionId,
    input.escrowId,
    input.disputeId,
    { outcome: input.outcome, note: input.note },
    input.apiKeyId,
  );

  const updatedDispute = await prisma.escrowDispute.update({
    where: { id: input.disputeId },
    data: {
      status: 'resolved',
      resolution: input.outcome,
      resolvedBy: 'admin',
      resolvedAt: new Date(),
      resolutionNote: input.note ?? null,
    },
  });
  await prisma.escrow.update({
    where: { id: escrow.id },
    data: { status: escrow.status },
  });

  await emitDisputeResolved(
    input.apiKeyId,
    {
      escrowId: escrow.id,
      disputeId: updatedDispute.id,
      outcome: input.outcome,
      status: escrow.status,
    },
    escrow.merchantId,
  );

  if (input.outcome === 'refund') {
    await emitEscrowRefunded(
      input.apiKeyId,
      {
        escrowId: escrow.id,
        disputeId: updatedDispute.id,
        outcome: input.outcome,
        status: escrow.status,
      },
      escrow.merchantId,
    );
  }

  return { data: { escrow, dispute: updatedDispute }, transitioned: true };
}
