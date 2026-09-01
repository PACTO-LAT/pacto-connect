import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  prisma: {
    merchantRiskListEntry: {
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import type { MerchantRiskListEntry } from '@prisma/client';
import { prisma } from '../db.js';
import {
  addRiskListEntry,
  findRiskListEntry,
  isCounterpartyListed,
  listRiskListEntries,
  RiskListEntryConflictError,
  removeRiskListEntry,
} from './lists.js';

const baseEntry: MerchantRiskListEntry = {
  id: 'rle_1',
  merchantId: 'mrc_1',
  listType: 'deny',
  counterpartyRef: 'wallet_bad',
  note: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('risk lists', () => {
  beforeEach(() => {
    vi.mocked(prisma.merchantRiskListEntry.create).mockReset();
    vi.mocked(prisma.merchantRiskListEntry.delete).mockReset();
    vi.mocked(prisma.merchantRiskListEntry.findMany).mockReset();
    vi.mocked(prisma.merchantRiskListEntry.findFirst).mockReset();
    vi.mocked(prisma.merchantRiskListEntry.findUnique).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('addRiskListEntry creates an entry', async () => {
    vi.mocked(prisma.merchantRiskListEntry.create).mockResolvedValue(baseEntry);

    const entry = await addRiskListEntry({
      merchantId: 'mrc_1',
      listType: 'deny',
      counterpartyRef: 'wallet_bad',
    });

    expect(entry).toEqual({
      id: 'rle_1',
      merchantId: 'mrc_1',
      listType: 'deny',
      counterpartyRef: 'wallet_bad',
      note: null,
      createdAt: baseEntry.createdAt,
    });
  });

  it('addRiskListEntry translates a unique-constraint violation into a typed conflict error', async () => {
    vi.mocked(prisma.merchantRiskListEntry.create).mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );

    await expect(
      addRiskListEntry({ merchantId: 'mrc_1', listType: 'deny', counterpartyRef: 'wallet_bad' }),
    ).rejects.toBeInstanceOf(RiskListEntryConflictError);
  });

  it('addRiskListEntry rethrows unrelated errors', async () => {
    vi.mocked(prisma.merchantRiskListEntry.create).mockRejectedValue(new Error('boom'));

    await expect(
      addRiskListEntry({ merchantId: 'mrc_1', listType: 'deny', counterpartyRef: 'wallet_bad' }),
    ).rejects.toThrow('boom');
  });

  it('removeRiskListEntry returns false when the entry does not belong to the merchant', async () => {
    vi.mocked(prisma.merchantRiskListEntry.findFirst).mockResolvedValue(null);
    expect(await removeRiskListEntry('mrc_1', 'rle_x')).toBe(false);
    expect(prisma.merchantRiskListEntry.delete).not.toHaveBeenCalled();
  });

  it('removeRiskListEntry deletes and returns true when found', async () => {
    vi.mocked(prisma.merchantRiskListEntry.findFirst).mockResolvedValue(baseEntry);
    expect(await removeRiskListEntry('mrc_1', 'rle_1')).toBe(true);
    expect(prisma.merchantRiskListEntry.delete).toHaveBeenCalledWith({ where: { id: 'rle_1' } });
  });

  it('listRiskListEntries filters by listType when provided', async () => {
    vi.mocked(prisma.merchantRiskListEntry.findMany).mockResolvedValue([baseEntry]);
    const entries = await listRiskListEntries('mrc_1', 'deny');
    expect(entries).toHaveLength(1);
    expect(prisma.merchantRiskListEntry.findMany).toHaveBeenCalledWith({
      where: { merchantId: 'mrc_1', listType: 'deny' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('isCounterpartyListed reports membership', async () => {
    vi.mocked(prisma.merchantRiskListEntry.findUnique).mockResolvedValue(baseEntry);
    expect(await isCounterpartyListed('mrc_1', 'wallet_bad', 'deny')).toBe(true);
  });

  it('isCounterpartyListed reports non-membership', async () => {
    vi.mocked(prisma.merchantRiskListEntry.findUnique).mockResolvedValue(null);
    expect(await isCounterpartyListed('mrc_1', 'wallet_ok', 'deny')).toBe(false);
  });

  it('findRiskListEntry queries the composite unique key', async () => {
    vi.mocked(prisma.merchantRiskListEntry.findUnique).mockResolvedValue(baseEntry);
    await findRiskListEntry('mrc_1', 'wallet_bad', 'deny');
    expect(prisma.merchantRiskListEntry.findUnique).toHaveBeenCalledWith({
      where: {
        merchantId_listType_counterpartyRef: {
          merchantId: 'mrc_1',
          listType: 'deny',
          counterpartyRef: 'wallet_bad',
        },
      },
    });
  });
});
