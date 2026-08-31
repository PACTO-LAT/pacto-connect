import { afterEach, describe, expect, it, vi } from 'vitest';
import { en, es } from './catalogues/index.js';
import { formatMessage, resolveKeyedMessage, resolveStepAnnouncement } from './messages.js';

describe('formatMessage', () => {
  it('substitutes named placeholders', () => {
    expect(formatMessage(en.labels.depositInstruction, { amount: '100', asset: 'USDC' })).toBe(
      'Deposit 100 USDC to the escrow contract.',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    expect(formatMessage('Hi {name}', {})).toBe('Hi {name}');
  });
});

describe('resolveKeyedMessage', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.unstubAllEnvs();
  });

  it('returns the value when the key exists', () => {
    expect(resolveKeyedMessage(en, 'steps', 'deposit', 'en')).toBe('Deposit to escrow');
  });

  it('throws in development when a dynamic key is missing from the catalogue', () => {
    process.env.NODE_ENV = 'development';
    expect(() => resolveKeyedMessage(en, 'milestones', 'refund.issued', 'en')).toThrow(
      /Missing i18n key/,
    );
  });

  it('falls back to the English copy in production when a dynamic key is missing', () => {
    process.env.NODE_ENV = 'production';
    const messages = { ...en, milestones: { ...en.milestones } as Record<string, string> };
    delete (messages.milestones as Record<string, string>)['fiat.reported'];

    expect(resolveKeyedMessage(messages, 'milestones', 'fiat.reported', 'pt')).toBe(
      en.milestones['fiat.reported'],
    );
  });

  it('falls back to the raw key in production when English also lacks it', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveKeyedMessage(en, 'milestones', 'refund.issued', 'en')).toBe('refund.issued');
  });
});

describe('resolveStepAnnouncement', () => {
  it('announces the plain step name for a non-terminal step', () => {
    expect(resolveStepAnnouncement(en, 'en', 'deposit')).toBe('Deposit to escrow');
    expect(resolveStepAnnouncement(en, 'en', 'selectListing')).toBe('Select a listing');
  });

  it('announces the detailed success copy, including the escrow id, for the success step', () => {
    expect(resolveStepAnnouncement(en, 'en', 'success', 'esc_1')).toBe(
      'Payment complete. Escrow esc_1 released.',
    );
  });

  it('announces the detailed disputed/refunded copy for those terminal steps', () => {
    expect(resolveStepAnnouncement(en, 'en', 'disputed', 'esc_1')).toBe(
      'Escrow esc_1 has been disputed.',
    );
    expect(resolveStepAnnouncement(en, 'en', 'refunded', 'esc_1')).toBe(
      'Escrow esc_1 has been refunded.',
    );
  });

  it('tolerates a missing escrow id rather than leaving the placeholder unresolved', () => {
    expect(resolveStepAnnouncement(en, 'en', 'success')).toBe(
      'Payment complete. Escrow  released.',
    );
  });

  it('respects the given locale and message set', () => {
    expect(resolveStepAnnouncement(es, 'es', 'deposit')).toBe('Depositar en garantía');
  });
});
