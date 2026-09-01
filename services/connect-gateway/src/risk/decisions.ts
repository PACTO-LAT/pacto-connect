import type { RiskDecision, RiskDecisionOutcome } from '@prisma/client';
import { prisma } from '../db.js';

export type { RiskDecisionOutcome };

export interface RiskDecisionPublic {
  id: string;
  merchantId: string;
  sessionId: string;
  counterpartyRef: string | null;
  amount: number;
  asset: string;
  outcome: RiskDecisionOutcome;
  reason: string;
  requestId: string | null;
  createdAt: Date;
}

export interface RecordRiskDecisionInput {
  merchantId: string;
  sessionId: string;
  counterpartyRef?: string | null;
  amount: number;
  asset: string;
  outcome: RiskDecisionOutcome;
  reason: string;
  requestId?: string;
}

function toPublic(record: RiskDecision): RiskDecisionPublic {
  return {
    id: record.id,
    merchantId: record.merchantId,
    sessionId: record.sessionId,
    counterpartyRef: record.counterpartyRef,
    amount: record.amount,
    asset: record.asset,
    outcome: record.outcome,
    reason: record.reason,
    requestId: record.requestId,
    createdAt: record.createdAt,
  };
}

export async function recordRiskDecision(
  input: RecordRiskDecisionInput,
): Promise<RiskDecisionPublic> {
  const record = await prisma.riskDecision.create({
    data: {
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      counterpartyRef: input.counterpartyRef ?? null,
      amount: input.amount,
      asset: input.asset,
      outcome: input.outcome,
      reason: input.reason,
      requestId: input.requestId ?? null,
    },
  });
  return toPublic(record);
}

export async function listRiskDecisions(
  merchantId: string,
  options?: { outcome?: RiskDecisionOutcome; limit?: number },
): Promise<RiskDecisionPublic[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const records = await prisma.riskDecision.findMany({
    where: { merchantId, ...(options?.outcome ? { outcome: options.outcome } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return records.map(toPublic);
}

export async function getRiskDecision(id: string): Promise<RiskDecisionPublic | null> {
  const record = await prisma.riskDecision.findUnique({ where: { id } });
  return record ? toPublic(record) : null;
}
