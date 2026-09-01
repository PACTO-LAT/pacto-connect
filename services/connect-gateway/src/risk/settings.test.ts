import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  prisma: {
    merchantRiskSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import type { MerchantRiskSettings } from '@prisma/client';
import { prisma } from '../db.js';
import { DEFAULT_RISK_VALUE_THRESHOLD } from './config.js';
import {
  getEffectiveRiskThresholds,
  getMerchantRiskSettings,
  upsertMerchantRiskSettings,
} from './settings.js';

const baseRecord: MerchantRiskSettings = {
  id: 'mrs_1',
  merchantId: 'mrc_1',
  windowMs: null,
  valueThreshold: 75_000,
  countThreshold: null,
  reviewValueThreshold: null,
  reviewCountThreshold: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

describe('risk settings', () => {
  beforeEach(() => {
    vi.mocked(prisma.merchantRiskSettings.findUnique).mockReset();
    vi.mocked(prisma.merchantRiskSettings.upsert).mockReset();
    delete process.env.RISK_VALUE_THRESHOLD;
  });
  afterEach(() => vi.restoreAllMocks());

  it('getMerchantRiskSettings returns all-null defaults when no row exists', async () => {
    vi.mocked(prisma.merchantRiskSettings.findUnique).mockResolvedValue(null);
    expect(await getMerchantRiskSettings('mrc_x')).toEqual({
      merchantId: 'mrc_x',
      windowMs: null,
      valueThreshold: null,
      countThreshold: null,
      reviewValueThreshold: null,
      reviewCountThreshold: null,
      updatedAt: null,
    });
  });

  it('getMerchantRiskSettings maps an existing row to the public shape', async () => {
    vi.mocked(prisma.merchantRiskSettings.findUnique).mockResolvedValue(baseRecord);
    const settings = await getMerchantRiskSettings('mrc_1');
    expect(settings.valueThreshold).toBe(75_000);
    expect(settings.windowMs).toBeNull();
    expect(settings.updatedAt).toEqual(baseRecord.updatedAt);
  });

  it('upsertMerchantRiskSettings normalizes undefined fields to null and upserts', async () => {
    vi.mocked(prisma.merchantRiskSettings.upsert).mockResolvedValue({
      ...baseRecord,
      valueThreshold: 90_000,
    });

    await upsertMerchantRiskSettings('mrc_1', { valueThreshold: 90_000 });

    expect(prisma.merchantRiskSettings.upsert).toHaveBeenCalledWith({
      where: { merchantId: 'mrc_1' },
      create: {
        merchantId: 'mrc_1',
        windowMs: null,
        valueThreshold: 90_000,
        countThreshold: null,
        reviewValueThreshold: null,
        reviewCountThreshold: null,
      },
      update: {
        windowMs: null,
        valueThreshold: 90_000,
        countThreshold: null,
        reviewValueThreshold: null,
        reviewCountThreshold: null,
      },
    });
  });

  it('getEffectiveRiskThresholds merges the merchant override with the platform default', async () => {
    vi.mocked(prisma.merchantRiskSettings.findUnique).mockResolvedValue(baseRecord);
    const effective = await getEffectiveRiskThresholds('mrc_1');
    expect(effective.valueThreshold).toBe(75_000); // merchant override
    expect(effective.countThreshold).toBeGreaterThan(0); // platform default
  });

  it('getEffectiveRiskThresholds falls fully back to platform defaults with no merchant row', async () => {
    vi.mocked(prisma.merchantRiskSettings.findUnique).mockResolvedValue(null);
    const effective = await getEffectiveRiskThresholds('mrc_x');
    expect(effective.valueThreshold).toBe(DEFAULT_RISK_VALUE_THRESHOLD);
  });
});
