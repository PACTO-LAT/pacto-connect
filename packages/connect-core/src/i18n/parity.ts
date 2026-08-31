import { en, es, pt } from './catalogues/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    isRecord(child) ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

/** Sorted, dot-joined key path signature used to compare catalogue shapes. */
export function catalogueKeySignature(catalogue: Record<string, unknown>): string {
  return keys(catalogue).sort().join('|');
}

/**
 * Throws when a bundled catalogue's key set drifts from the canonical (`en`)
 * shape. Called at module initialization so a missing translation fails the
 * build/boot instead of surfacing as a blank string in production.
 */
export function assertCatalogueParity(): void {
  const canonical = catalogueKeySignature(en as unknown as Record<string, unknown>);
  for (const [locale, catalogue] of [
    ['es', es],
    ['pt', pt],
  ] as const) {
    const signature = catalogueKeySignature(catalogue as unknown as Record<string, unknown>);
    if (signature !== canonical) {
      throw new Error(
        `Pacto message catalogues must have matching keys (locale "${locale}" drifted from "en")`,
      );
    }
  }
}
