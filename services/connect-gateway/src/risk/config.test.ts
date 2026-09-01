import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_COUNT_THRESHOLD,
  DEFAULT_RISK_REVIEW_RATIO,
  DEFAULT_RISK_VALUE_THRESHOLD,
  DEFAULT_RISK_WINDOW_MS,
  getRiskPlatformDefaults,
  resolveRiskThresholds,
} from './config.js';

const ENV_KEYS = [
  'RISK_WINDOW_MS',
  'RISK_VALUE_THRESHOLD',
  'RISK_COUNT_THRESHOLD',
  'RISK_REVIEW_RATIO',
  'RISK_REVIEW_VALUE_THRESHOLD',
  'RISK_REVIEW_COUNT_THRESHOLD',
];

describe('getRiskPlatformDefaults', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  it('falls back to hardcoded defaults with no env configured', () => {
    expect(getRiskPlatformDefaults()).toEqual({
      windowMs: DEFAULT_RISK_WINDOW_MS,
      valueThreshold: DEFAULT_RISK_VALUE_THRESHOLD,
      countThreshold: DEFAULT_RISK_COUNT_THRESHOLD,
      reviewValueThreshold: DEFAULT_RISK_VALUE_THRESHOLD * DEFAULT_RISK_REVIEW_RATIO,
      reviewCountThreshold: Math.round(DEFAULT_RISK_COUNT_THRESHOLD * DEFAULT_RISK_REVIEW_RATIO),
    });
  });

  it('reads overrides from env', () => {
    process.env.RISK_WINDOW_MS = '3600000';
    process.env.RISK_VALUE_THRESHOLD = '1000';
    process.env.RISK_COUNT_THRESHOLD = '10';
    process.env.RISK_REVIEW_RATIO = '0.5';

    expect(getRiskPlatformDefaults()).toEqual({
      windowMs: 3_600_000,
      valueThreshold: 1000,
      countThreshold: 10,
      reviewValueThreshold: 500,
      reviewCountThreshold: 5,
    });
  });

  it('an explicit review threshold env var wins over the ratio-derived default', () => {
    process.env.RISK_VALUE_THRESHOLD = '1000';
    process.env.RISK_REVIEW_RATIO = '0.5';
    process.env.RISK_REVIEW_VALUE_THRESHOLD = '900';

    expect(getRiskPlatformDefaults().reviewValueThreshold).toBe(900);
  });

  it('ignores an invalid ratio and falls back to the default ratio', () => {
    process.env.RISK_REVIEW_RATIO = '5'; // out of (0,1] range
    expect(getRiskPlatformDefaults().reviewValueThreshold).toBe(
      DEFAULT_RISK_VALUE_THRESHOLD * DEFAULT_RISK_REVIEW_RATIO,
    );
  });
});

describe('resolveRiskThresholds', () => {
  const platformDefaults = {
    windowMs: 1000,
    valueThreshold: 100,
    countThreshold: 10,
    reviewValueThreshold: 80,
    reviewCountThreshold: 8,
  };

  it('uses the platform default for every field when there are no merchant overrides', () => {
    expect(resolveRiskThresholds(null, platformDefaults)).toEqual(platformDefaults);
    expect(resolveRiskThresholds(undefined, platformDefaults)).toEqual(platformDefaults);
  });

  it('resolves merchant first, field by field, falling back to platform default per field', () => {
    const resolved = resolveRiskThresholds(
      {
        valueThreshold: 500,
        // countThreshold left unset -> platform default
        countThreshold: null,
        reviewValueThreshold: 400,
      },
      platformDefaults,
    );

    expect(resolved).toEqual({
      windowMs: 1000, // platform default (no merchant override)
      valueThreshold: 500, // merchant override
      countThreshold: 10, // platform default (merchant field is null)
      reviewValueThreshold: 400, // merchant override
      reviewCountThreshold: 8, // platform default
    });
  });
});
