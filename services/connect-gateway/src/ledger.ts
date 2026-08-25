import type {
  LedgerDirection,
  LedgerEntry,
  LedgerEntryKind,
  Prisma,
  SettlementPeriod,
  SettlementPeriodStatus,
} from '@prisma/client';
import { prisma } from './db.js';

export class PeriodClosedError extends Error {
  constructor(periodKey: string) {
    super(`settlement period ${periodKey} is closed`);
    this.name = 'PeriodClosedError';
  }
}

export class LedgerEntryNotFoundError extends Error {
  constructor(entryId: string) {
    super(`ledger entry ${entryId} not found`);
    this.name = 'LedgerEntryNotFoundError';
  }
}

export interface LedgerEntryPublic {
  id: string;
  merchantId: string;
  periodId: string;
  periodKey: string;
  sourceEscrowId: string | null;
  direction: LedgerDirection;
  kind: LedgerEntryKind;
  amount: number;
  asset: string;
  correctsEntryId: string | null;
  occurredAt: Date;
  createdAt: Date;
  payoutRunId: string | null;
}

export interface SettlementPeriodPublic {
  id: string;
  merchantId: string;
  periodKey: string;
  startsAt: Date;
  endsAt: Date;
  status: SettlementPeriodStatus;
  closedAt: Date | null;
  createdAt: Date;
}

const PERIOD_KEY_RE = /^\d{4}-\d{2}$/;

export function parsePeriodKey(periodKey: string): { startsAt: Date; endsAt: Date } {
  if (!PERIOD_KEY_RE.test(periodKey)) {
    throw new Error(`invalid period key: ${periodKey}`);
  }
  const [yearStr, monthStr] = periodKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month < 1 || month > 12) {
    throw new Error(`invalid period key: ${periodKey}`);
  }
  const startsAt = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endsAt = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { startsAt, endsAt };
}

export function periodKeyForDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function toPeriodPublic(record: SettlementPeriod): SettlementPeriodPublic {
  return {
    id: record.id,
    merchantId: record.merchantId,
    periodKey: record.periodKey,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    status: record.status,
    closedAt: record.closedAt,
    createdAt: record.createdAt,
  };
}

function toEntryPublic(record: LedgerEntry, periodKey: string): LedgerEntryPublic {
  return {
    id: record.id,
    merchantId: record.merchantId,
    periodId: record.periodId,
    periodKey,
    sourceEscrowId: record.sourceEscrowId,
    direction: record.direction,
    kind: record.kind,
    amount: record.amount,
    asset: record.asset,
    correctsEntryId: record.correctsEntryId,
    occurredAt: record.occurredAt,
    createdAt: record.createdAt,
    payoutRunId: record.payoutRunId,
  };
}

export function signedAmount(direction: LedgerDirection, amount: number): number {
  return direction === 'credit' ? amount : -amount;
}

type DbClient = Prisma.TransactionClient | typeof prisma;

async function getOrCreateOpenPeriod(
  tx: DbClient,
  merchantId: string,
  occurredAt: Date,
): Promise<SettlementPeriod> {
  const periodKey = periodKeyForDate(occurredAt);
  const { startsAt, endsAt } = parsePeriodKey(periodKey);

  const existing = await tx.settlementPeriod.findUnique({
    where: { merchantId_periodKey: { merchantId, periodKey } },
  });
  if (existing) {
    if (existing.status === 'closed') {
      throw new PeriodClosedError(periodKey);
    }
    if (occurredAt < existing.startsAt || occurredAt >= existing.endsAt) {
      throw new PeriodClosedError(periodKey);
    }
    return existing;
  }

  return tx.settlementPeriod.create({
    data: {
      merchantId,
      periodKey,
      startsAt,
      endsAt,
      status: 'open',
    },
  });
}

export async function appendSettlementEntry(
  tx: DbClient,
  input: {
    merchantId: string;
    sourceEscrowId: string;
    amount: number;
    asset: string;
    occurredAt?: Date;
  },
): Promise<LedgerEntryPublic> {
  const occurredAt = input.occurredAt ?? new Date();
  const period = await getOrCreateOpenPeriod(tx, input.merchantId, occurredAt);
  const record = await tx.ledgerEntry.create({
    data: {
      merchantId: input.merchantId,
      periodId: period.id,
      sourceEscrowId: input.sourceEscrowId,
      direction: 'credit',
      kind: 'settlement',
      amount: input.amount,
      asset: input.asset,
      occurredAt,
    },
  });
  return toEntryPublic(record, period.periodKey);
}

export async function appendCorrectionEntry(input: {
  merchantId: string;
  correctsEntryId: string;
  amount?: number;
  reason?: string;
  occurredAt?: Date;
}): Promise<LedgerEntryPublic> {
  const occurredAt = input.occurredAt ?? new Date();
  const original = await prisma.ledgerEntry.findUnique({
    where: { id: input.correctsEntryId },
  });
  if (!original || original.merchantId !== input.merchantId) {
    throw new LedgerEntryNotFoundError(input.correctsEntryId);
  }

  const correctionAmount = input.amount ?? original.amount;
  const correctionDirection: LedgerDirection = original.direction === 'credit' ? 'debit' : 'credit';

  const period = await getOrCreateOpenPeriod(prisma, input.merchantId, occurredAt);
  const record = await prisma.ledgerEntry.create({
    data: {
      merchantId: input.merchantId,
      periodId: period.id,
      sourceEscrowId: original.sourceEscrowId,
      direction: correctionDirection,
      kind: 'correction',
      amount: correctionAmount,
      asset: original.asset,
      correctsEntryId: original.id,
      occurredAt,
    },
  });
  return toEntryPublic(record, period.periodKey);
}

export async function closeSettlementPeriod(
  merchantId: string,
  periodKey: string,
): Promise<SettlementPeriodPublic> {
  parsePeriodKey(periodKey);
  const existing = await prisma.settlementPeriod.findUnique({
    where: { merchantId_periodKey: { merchantId, periodKey } },
  });
  if (!existing) {
    const { startsAt, endsAt } = parsePeriodKey(periodKey);
    const created = await prisma.settlementPeriod.create({
      data: {
        merchantId,
        periodKey,
        startsAt,
        endsAt,
        status: 'closed',
        closedAt: new Date(),
      },
    });
    await prisma.payoutRun.updateMany({
      where: { periodId: created.id, status: 'open' },
      data: { status: 'finalized', finalizedAt: new Date() },
    });
    return toPeriodPublic(created);
  }

  if (existing.status === 'closed') {
    return toPeriodPublic(existing);
  }

  const closed = await prisma.settlementPeriod.update({
    where: { id: existing.id },
    data: { status: 'closed', closedAt: new Date() },
  });
  await prisma.payoutRun.updateMany({
    where: { periodId: closed.id, status: 'open' },
    data: { status: 'finalized', finalizedAt: new Date() },
  });
  return toPeriodPublic(closed);
}

export async function getSettlementPeriod(
  merchantId: string,
  periodKey: string,
): Promise<SettlementPeriodPublic | null> {
  parsePeriodKey(periodKey);
  const record = await prisma.settlementPeriod.findUnique({
    where: { merchantId_periodKey: { merchantId, periodKey } },
  });
  return record ? toPeriodPublic(record) : null;
}

export async function getLedgerEntry(entryId: string): Promise<LedgerEntryPublic | null> {
  const record = await prisma.ledgerEntry.findUnique({
    where: { id: entryId },
    include: { period: true },
  });
  if (!record) {
    return null;
  }
  return toEntryPublic(record, record.period.periodKey);
}
