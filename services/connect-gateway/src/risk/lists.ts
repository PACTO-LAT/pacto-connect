import type { MerchantRiskListEntry, RiskListType } from '@prisma/client';
import { prisma } from '../db.js';

export type { RiskListType };

export interface RiskListEntryPublic {
  id: string;
  merchantId: string;
  listType: RiskListType;
  counterpartyRef: string;
  note: string | null;
  createdAt: Date;
}

export class RiskListEntryConflictError extends Error {
  constructor(listType: RiskListType, counterpartyRef: string) {
    super(`${counterpartyRef} is already on the ${listType} list`);
    this.name = 'RiskListEntryConflictError';
  }
}

function toPublic(record: MerchantRiskListEntry): RiskListEntryPublic {
  return {
    id: record.id,
    merchantId: record.merchantId,
    listType: record.listType,
    counterpartyRef: record.counterpartyRef,
    note: record.note,
    createdAt: record.createdAt,
  };
}

export async function addRiskListEntry(input: {
  merchantId: string;
  listType: RiskListType;
  counterpartyRef: string;
  note?: string;
}): Promise<RiskListEntryPublic> {
  try {
    const record = await prisma.merchantRiskListEntry.create({
      data: {
        merchantId: input.merchantId,
        listType: input.listType,
        counterpartyRef: input.counterpartyRef,
        note: input.note ?? null,
      },
    });
    return toPublic(record);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new RiskListEntryConflictError(input.listType, input.counterpartyRef);
    }
    throw error;
  }
}

export async function removeRiskListEntry(merchantId: string, entryId: string): Promise<boolean> {
  const existing = await prisma.merchantRiskListEntry.findFirst({
    where: { id: entryId, merchantId },
  });
  if (!existing) {
    return false;
  }
  await prisma.merchantRiskListEntry.delete({ where: { id: entryId } });
  return true;
}

export async function listRiskListEntries(
  merchantId: string,
  listType?: RiskListType,
): Promise<RiskListEntryPublic[]> {
  const records = await prisma.merchantRiskListEntry.findMany({
    where: { merchantId, ...(listType ? { listType } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  return records.map(toPublic);
}

export async function findRiskListEntry(
  merchantId: string,
  counterpartyRef: string,
  listType: RiskListType,
): Promise<RiskListEntryPublic | null> {
  const record = await prisma.merchantRiskListEntry.findUnique({
    where: {
      merchantId_listType_counterpartyRef: { merchantId, listType, counterpartyRef },
    },
  });
  return record ? toPublic(record) : null;
}

export async function isCounterpartyListed(
  merchantId: string,
  counterpartyRef: string,
  listType: RiskListType,
): Promise<boolean> {
  return (await findRiskListEntry(merchantId, counterpartyRef, listType)) !== null;
}
