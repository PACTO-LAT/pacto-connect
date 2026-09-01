import type { MerchantRiskSettings } from '@prisma/client';
import { prisma } from '../db.js';
import { getRiskPlatformDefaults, type RiskThresholds, resolveRiskThresholds } from './config.js';

export interface MerchantRiskSettingsPublic {
  merchantId: string;
  windowMs: number | null;
  valueThreshold: number | null;
  countThreshold: number | null;
  reviewValueThreshold: number | null;
  reviewCountThreshold: number | null;
  updatedAt: Date | null;
}

export interface MerchantRiskSettingsInput {
  windowMs?: number | null;
  valueThreshold?: number | null;
  countThreshold?: number | null;
  reviewValueThreshold?: number | null;
  reviewCountThreshold?: number | null;
}

function toPublic(
  merchantId: string,
  record: MerchantRiskSettings | null,
): MerchantRiskSettingsPublic {
  if (!record) {
    return {
      merchantId,
      windowMs: null,
      valueThreshold: null,
      countThreshold: null,
      reviewValueThreshold: null,
      reviewCountThreshold: null,
      updatedAt: null,
    };
  }

  return {
    merchantId: record.merchantId,
    windowMs: record.windowMs,
    valueThreshold: record.valueThreshold,
    countThreshold: record.countThreshold,
    reviewValueThreshold: record.reviewValueThreshold,
    reviewCountThreshold: record.reviewCountThreshold,
    updatedAt: record.updatedAt,
  };
}

export async function getMerchantRiskSettings(
  merchantId: string,
): Promise<MerchantRiskSettingsPublic> {
  const record = await prisma.merchantRiskSettings.findUnique({ where: { merchantId } });
  return toPublic(merchantId, record);
}

export async function upsertMerchantRiskSettings(
  merchantId: string,
  input: MerchantRiskSettingsInput,
): Promise<MerchantRiskSettingsPublic> {
  const data = {
    windowMs: input.windowMs ?? null,
    valueThreshold: input.valueThreshold ?? null,
    countThreshold: input.countThreshold ?? null,
    reviewValueThreshold: input.reviewValueThreshold ?? null,
    reviewCountThreshold: input.reviewCountThreshold ?? null,
  };

  const record = await prisma.merchantRiskSettings.upsert({
    where: { merchantId },
    create: { merchantId, ...data },
    update: data,
  });

  return toPublic(merchantId, record);
}

/** The settings a merchant would evaluate against right now: raw overrides
 * merged with the platform default, field by field. */
export async function getEffectiveRiskThresholds(merchantId: string): Promise<RiskThresholds> {
  const settings = await getMerchantRiskSettings(merchantId);
  return resolveRiskThresholds(settings, getRiskPlatformDefaults());
}
