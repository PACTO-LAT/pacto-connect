import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from './catalogues/index.js';
import { formatMessage, resolveKeyedMessage } from './messages.js';

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
