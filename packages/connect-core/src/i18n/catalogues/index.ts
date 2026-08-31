import type { PactoLocale } from '../types.js';
import { en } from './en.js';
import { es } from './es.js';
import { pt } from './pt.js';

export { en, es, pt };

export const LOCALES: Record<PactoLocale, typeof en> = { en, es, pt };

/** Region-to-locale mapping for the fiat rails Pacto currently supports. */
export const REGION_LOCALES: Record<string, PactoLocale> = {
  BR: 'pt',
  CR: 'es',
  MX: 'es',
};
