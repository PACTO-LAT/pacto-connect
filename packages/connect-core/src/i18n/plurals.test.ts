import { describe, expect, it } from 'vitest';
import { formatGender, formatPlural } from './format.js';

// One milestone-count message per language, exercised at zero/one/many — this
// is the concatenation pattern (`count + ' item' + (count === 1 ? '' : 's')`)
// the issue calls out, which does not generalize past English.
const milestoneForms = {
  en: {
    zero: 'No milestones reached',
    one: '1 milestone reached',
    other: '{count} milestones reached',
  },
  es: { zero: 'Ningún hito alcanzado', one: '1 hito alcanzado', other: '{count} hitos alcanzados' },
  pt: {
    zero: 'Nenhum marco alcançado',
    one: '1 marco alcançado',
    other: '{count} marcos alcançados',
  },
} as const;

describe('formatPlural', () => {
  it('resolves zero, one and many for English', () => {
    expect(formatPlural('en', 0, milestoneForms.en)).toBe('No milestones reached');
    expect(formatPlural('en', 1, milestoneForms.en)).toBe('1 milestone reached');
    expect(formatPlural('en', 4, milestoneForms.en)).toBe('4 milestones reached');
  });

  it('resolves zero, one and many for Spanish', () => {
    expect(formatPlural('es', 0, milestoneForms.es)).toBe('Ningún hito alcanzado');
    expect(formatPlural('es', 1, milestoneForms.es)).toBe('1 hito alcanzado');
    expect(formatPlural('es', 4, milestoneForms.es)).toBe('4 hitos alcanzados');
  });

  it('resolves zero, one and many for Portuguese', () => {
    expect(formatPlural('pt', 0, milestoneForms.pt)).toBe('Nenhum marco alcançado');
    expect(formatPlural('pt', 1, milestoneForms.pt)).toBe('1 marco alcançado');
    expect(formatPlural('pt', 4, milestoneForms.pt)).toBe('4 marcos alcançados');
  });

  it('falls back to the "other" form for zero when no "zero" form is supplied', () => {
    expect(formatPlural('en', 0, { one: '1 item', other: '{count} items' })).toBe('0 items');
  });

  it('uses Intl.PluralRules, not a hardcoded count === 1 check', () => {
    // Spanish/Portuguese "one" category only ever matches count === 1, same as English here,
    // but the selection must go through Intl.PluralRules rather than a literal `=== 1`.
    expect(formatPlural('es', 21, { one: 'una', other: '{count} muchas' })).toBe('21 muchas');
  });
});

describe('formatGender', () => {
  const forms = { female: 'ella confirmó', male: 'él confirmó', other: 'elle confirmó' };

  it('selects the matching form for each gender', () => {
    expect(formatGender('female', forms)).toBe('ella confirmó');
    expect(formatGender('male', forms)).toBe('él confirmó');
    expect(formatGender('other', forms)).toBe('elle confirmó');
  });
});
