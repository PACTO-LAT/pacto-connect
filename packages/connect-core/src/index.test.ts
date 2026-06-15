import { describe, expect, it } from 'vitest';
import { init, VERSION } from './index';

describe('@pacto-connect/core', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('init throws without a publishableKey', () => {
    // @ts-expect-error intentionally missing required option
    expect(() => init({})).toThrow(/publishableKey is required/);
  });

  it('init returns a client with the default gateway url', () => {
    const client = init({ publishableKey: 'pk_test_123' });
    expect(client.publishableKey).toBe('pk_test_123');
    expect(client.gatewayUrl).toContain('http');
  });
});
