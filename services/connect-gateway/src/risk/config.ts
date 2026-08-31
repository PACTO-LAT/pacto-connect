// Platform-wide velocity defaults, and the merchant-first/platform-default
// resolution order documented in RISK_CONTROLS.md.
//
// Defaults: a 24h rolling window, a $50,000 cumulative value ceiling, and a
// 200-transaction count ceiling are sized to absorb normal peak-day P2P
// remittance activity for a small-to-mid merchant while still capping a
// leaked-key blast radius to a bounded, single-day dollar amount instead of
// an unbounded one. The review tier fires at 80% of the block threshold so a
// merchant's own traffic gets flagged (and can be allow-listed or have its
// threshold raised) before it is ever hard-blocked.
export interface RiskThresholds {
  windowMs: number;
  valueThreshold: number;
  countThreshold: number;
  reviewValueThreshold: number;
  reviewCountThreshold: number;
}

export const DEFAULT_RISK_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RISK_VALUE_THRESHOLD = 50_000;
export const DEFAULT_RISK_COUNT_THRESHOLD = 200;
export const DEFAULT_RISK_REVIEW_RATIO = 0.8;

export interface MerchantRiskThresholdOverrides {
  windowMs?: number | null;
  valueThreshold?: number | null;
  countThreshold?: number | null;
  reviewValueThreshold?: number | null;
  reviewCountThreshold?: number | null;
}

function parsePositiveEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatioEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

/** Platform-wide defaults, read fresh from env on every call (no caching). */
export function getRiskPlatformDefaults(): RiskThresholds {
  const windowMs = parsePositiveEnv('RISK_WINDOW_MS', DEFAULT_RISK_WINDOW_MS);
  const valueThreshold = parsePositiveEnv('RISK_VALUE_THRESHOLD', DEFAULT_RISK_VALUE_THRESHOLD);
  const countThreshold = parsePositiveEnv('RISK_COUNT_THRESHOLD', DEFAULT_RISK_COUNT_THRESHOLD);
  const reviewRatio = parseRatioEnv('RISK_REVIEW_RATIO', DEFAULT_RISK_REVIEW_RATIO);

  const reviewValueThreshold = parsePositiveEnv(
    'RISK_REVIEW_VALUE_THRESHOLD',
    valueThreshold * reviewRatio,
  );
  const reviewCountThreshold = parsePositiveEnv(
    'RISK_REVIEW_COUNT_THRESHOLD',
    Math.max(1, Math.round(countThreshold * reviewRatio)),
  );

  return { windowMs, valueThreshold, countThreshold, reviewValueThreshold, reviewCountThreshold };
}

/**
 * Resolve effective thresholds for a merchant: each field independently
 * falls back from the merchant's own setting (when non-null) to the
 * platform default. This is the documented "merchant first, then platform
 * default" resolution order.
 */
export function resolveRiskThresholds(
  overrides: MerchantRiskThresholdOverrides | null | undefined,
  platformDefaults: RiskThresholds = getRiskPlatformDefaults(),
): RiskThresholds {
  return {
    windowMs: overrides?.windowMs ?? platformDefaults.windowMs,
    valueThreshold: overrides?.valueThreshold ?? platformDefaults.valueThreshold,
    countThreshold: overrides?.countThreshold ?? platformDefaults.countThreshold,
    reviewValueThreshold: overrides?.reviewValueThreshold ?? platformDefaults.reviewValueThreshold,
    reviewCountThreshold: overrides?.reviewCountThreshold ?? platformDefaults.reviewCountThreshold,
  };
}
