import { prisma } from './db.js';
import { type LedgerEntryPublic, parsePeriodKey, signedAmount } from './ledger.js';

export interface StatementAssetSection {
  asset: string;
  opening: number;
  entries: LedgerEntryPublic[];
  closing: number;
}

export interface MerchantStatement {
  merchantId: string;
  periodKey: string;
  startsAt: Date;
  endsAt: Date;
  assets: StatementAssetSection[];
}

export async function generateMerchantStatement(input: {
  merchantId: string;
  periodKey: string;
}): Promise<MerchantStatement | null> {
  parsePeriodKey(input.periodKey);
  const period = await prisma.settlementPeriod.findUnique({
    where: {
      merchantId_periodKey: {
        merchantId: input.merchantId,
        periodKey: input.periodKey,
      },
    },
  });
  if (!period) {
    return null;
  }

  const periodEntries = await prisma.ledgerEntry.findMany({
    where: { merchantId: input.merchantId, periodId: period.id },
    include: { period: true },
    orderBy: [{ asset: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }],
  });

  const priorEntries = await prisma.ledgerEntry.findMany({
    where: {
      merchantId: input.merchantId,
      occurredAt: { lt: period.startsAt },
    },
    orderBy: [{ asset: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }],
  });

  const assets = new Set<string>();
  for (const entry of priorEntries) {
    assets.add(entry.asset);
  }
  for (const entry of periodEntries) {
    assets.add(entry.asset);
  }

  const sections: StatementAssetSection[] = [...assets].sort().map((asset) => {
    const opening = priorEntries
      .filter((entry) => entry.asset === asset)
      .reduce((sum, entry) => sum + signedAmount(entry.direction, entry.amount), 0);

    const entries: LedgerEntryPublic[] = periodEntries
      .filter((entry) => entry.asset === asset)
      .map((entry) => ({
        id: entry.id,
        merchantId: entry.merchantId,
        periodId: entry.periodId,
        periodKey: entry.period.periodKey,
        sourceEscrowId: entry.sourceEscrowId,
        direction: entry.direction,
        kind: entry.kind,
        amount: entry.amount,
        asset: entry.asset,
        correctsEntryId: entry.correctsEntryId,
        occurredAt: entry.occurredAt,
        createdAt: entry.createdAt,
        payoutRunId: entry.payoutRunId,
      }));

    const closing =
      opening +
      entries.reduce((sum, entry) => sum + signedAmount(entry.direction, entry.amount), 0);

    return { asset, opening, entries, closing };
  });

  return {
    merchantId: input.merchantId,
    periodKey: period.periodKey,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    assets: sections,
  };
}

export function assertStatementReconciles(statement: MerchantStatement): boolean {
  return statement.assets.every((section) => {
    const entrySum = section.entries.reduce(
      (sum, entry) => sum + signedAmount(entry.direction, entry.amount),
      0,
    );
    return section.opening + entrySum === section.closing;
  });
}
