/**
 * Localized copy for the checkout widget. `en` is the canonical catalogue;
 * `es` and `pt` must carry the same key set (enforced by `assertCatalogueParity`,
 * run once below at module init). Merchants pick a locale via
 * `resolveMessages(locale)` and can patch individual strings — or supply a
 * whole new language — through the `overrides` argument.
 *
 * Locale resolution follows a fixed chain: explicit host locale, then the
 * selected rail's region, then English (`resolveLocale`).
 */

export { en, es, pt } from './catalogues/index.js';
export type { Gender, PluralForms } from './format.js';
export {
  formatAssetAmount,
  formatCurrency,
  formatDate,
  formatGender,
  formatPlural,
} from './format.js';
export { formatMessage, resolveKeyedMessage, resolveStepAnnouncement } from './messages.js';
export { assertCatalogueParity, catalogueKeySignature } from './parity.js';
export { resolveLocale, resolveMessages } from './resolve.js';
export type { LocaleResolutionOptions, PactoLocale, PactoMessages, RailRegion } from './types.js';

import { assertCatalogueParity } from './parity.js';

assertCatalogueParity();
