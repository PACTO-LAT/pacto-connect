import { describe, expect, it } from 'vitest';
import { VERSION } from './index';

describe('@pacto-connect/elements', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
