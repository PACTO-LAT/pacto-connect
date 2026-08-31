import type { PactoLocale } from './types.js';

/** Format a monetary amount per locale (grouping, decimal separator, symbol placement). Requires an ISO-4217 code. */
export function formatCurrency(value: number, currency: string, locale: PactoLocale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

/**
 * Locale-aware decimal formatting (grouping + decimal separator) for
 * quantities that are not ISO-4217 currencies, e.g. a listing or escrow's
 * crypto asset amount (`USDC`, `XLM`, …), which `formatCurrency` rejects.
 */
export function formatAssetAmount(value: number, locale: PactoLocale): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  }).format(value);
}

/** Format a date/timestamp per locale. */
export function formatDate(value: Date | string | number, locale: PactoLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}

export interface PluralForms {
  zero?: string;
  one: string;
  other: string;
}

/**
 * Resolve a count to its plural category via `Intl.PluralRules` and interpolate
 * `{count}` into the matching form. Replaces ad-hoc string concatenation
 * (`count + ' item' + (count === 1 ? '' : 's')`), which does not generalize to
 * Spanish/Portuguese plural rules or to a `zero` form.
 */
export function formatPlural(locale: PactoLocale, count: number, forms: PluralForms): string {
  if (count === 0 && forms.zero) {
    return forms.zero.replace('{count}', String(count));
  }
  const category = new Intl.PluralRules(locale).select(count);
  const template = category === 'one' ? forms.one : forms.other;
  return template.replace('{count}', String(count));
}

export type Gender = 'female' | 'male' | 'other';

/** Select a gender-specific message form. */
export function formatGender(gender: Gender, forms: Record<Gender, string>): string {
  return forms[gender];
}
