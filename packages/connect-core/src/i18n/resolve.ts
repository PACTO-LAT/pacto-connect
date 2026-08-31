import type { DeepPartial } from '../theme.js';
import { LOCALES, REGION_LOCALES } from './catalogues/index.js';
import type { LocaleResolutionOptions, PactoLocale, PactoMessages } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge `patch` onto a structural clone of `base`; never mutates inputs. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isRecord(patch)) {
    return base;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isRecord(current) && isRecord(value)) {
      result[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Deterministic locale fallback chain: explicit host locale, then the rail's
 * region, then English. A host locale like `pt-BR` is matched on its base
 * subtag; an unresolvable region or locale falls through to `en`.
 */
export function resolveLocale(input?: PactoLocale | string | LocaleResolutionOptions): PactoLocale {
  const options = typeof input === 'object' ? input : { locale: input };
  const candidate = options.locale?.toLowerCase().split('-')[0];
  if (candidate && candidate in LOCALES) {
    return candidate as PactoLocale;
  }
  return REGION_LOCALES[options.railRegion?.toUpperCase() ?? ''] ?? 'en';
}

/**
 * Resolve a locale to its message set, deep-merged with optional overrides.
 * Unknown locales fall back to English. Pass a full `PactoMessages` shape via
 * `overrides` to register a language that is not built in.
 */
export function resolveMessages(
  locale?: PactoLocale | string | LocaleResolutionOptions,
  overrides?: DeepPartial<PactoMessages>,
): PactoMessages {
  const base = LOCALES[resolveLocale(locale)];
  if (!overrides) {
    return base;
  }
  return deepMerge(base, overrides);
}
