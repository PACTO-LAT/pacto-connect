import { describe, expect, it } from 'vitest';
import { en, es, pt } from './catalogues/index.js';
import { resolveLocale, resolveMessages } from './resolve.js';

describe('resolveLocale — fallback chain', () => {
  it('uses the explicit host locale when given directly', () => {
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('pt')).toBe('pt');
    expect(resolveLocale('en')).toBe('en');
  });

  it('matches a host locale on its base subtag (e.g. "pt-BR")', () => {
    expect(resolveLocale('pt-BR')).toBe('pt');
    expect(resolveLocale('es-CR')).toBe('es');
  });

  it('prefers the explicit host locale over the rail region', () => {
    expect(resolveLocale({ locale: 'pt-BR', railRegion: 'MX' })).toBe('pt');
  });

  it('falls back to the rail region when no host locale is given', () => {
    expect(resolveLocale({ railRegion: 'BR' })).toBe('pt');
    expect(resolveLocale({ railRegion: 'MX' })).toBe('es');
    expect(resolveLocale({ railRegion: 'CR' })).toBe('es');
  });

  it('matches the rail region case-insensitively', () => {
    expect(resolveLocale({ railRegion: 'br' })).toBe('pt');
  });

  it('falls back to English when neither locale nor region resolve', () => {
    expect(resolveLocale()).toBe('en');
    expect(resolveLocale({ railRegion: 'unknown' })).toBe('en');
    expect(resolveLocale({ locale: 'fr', railRegion: 'unknown' })).toBe('en');
  });
});

describe('resolveMessages', () => {
  it('returns the English dictionary by default', () => {
    expect(resolveMessages()).toBe(en);
    expect(resolveMessages('en')).toBe(en);
  });

  it('returns the Spanish dictionary for "es"', () => {
    const msgs = resolveMessages('es');
    expect(msgs.actions.confirmDeposit).toBe(es.actions.confirmDeposit);
    expect(msgs.steps.deposit).toBe('Depositar en garantía');
  });

  it('returns the Portuguese dictionary for "pt"', () => {
    expect(resolveMessages('pt')).toBe(pt);
  });

  it('falls back to English for an unknown locale', () => {
    expect(resolveMessages('fr')).toEqual(en);
  });

  it('resolves through rail region when no host locale is given', () => {
    expect(resolveMessages({ railRegion: 'BR' })).toBe(pt);
  });

  it('deep-merges overrides over the base locale', () => {
    const msgs = resolveMessages('es', { actions: { confirmDeposit: 'Pagar ahora' } });
    expect(msgs.actions.confirmDeposit).toBe('Pagar ahora');
    expect(msgs.actions.submitReceipt).toBe(es.actions.submitReceipt);
    expect(msgs.steps.deposit).toBe('Depositar en garantía');
  });

  it('does not mutate the base dictionaries', () => {
    resolveMessages('en', { actions: { retry: 'Again' } });
    expect(en.actions.retry).toBe('Retry');
  });
});
