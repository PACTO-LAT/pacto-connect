import { STYLE_ELEMENT_ID } from '@pacto-connect/core';
import { afterEach, describe, expect, it } from 'vitest';
import { injectPactoCheckoutStyles } from './index.js';

describe('injectPactoCheckoutStyles', () => {
  afterEach(() => {
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
  });

  it('injects the tokenized stylesheet once', () => {
    const first = injectPactoCheckoutStyles();
    const second = injectPactoCheckoutStyles();
    expect(first).toBeInstanceOf(HTMLStyleElement);
    expect(second).toBe(first);
    expect(first?.textContent).toContain('--pacto-color-primary');
  });

  it('includes the accessibility rules (sr-only live region, visible focus indicator)', () => {
    const style = injectPactoCheckoutStyles();
    expect(style?.textContent).toContain('.pacto-checkout-sr-only');
    expect(style?.textContent).toContain(':focus-visible');
  });
});
