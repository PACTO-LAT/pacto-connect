import { describe, expect, it, vi } from 'vitest';
import {
  buildCheckoutStylesheet,
  DEFAULT_THEME,
  formatThemeContrastWarning,
  resolveTheme,
  STYLE_ELEMENT_ID,
  themeToCssVars,
  validateThemeContrast,
  warnOnThemeContrastIssues,
} from './theme.js';

describe('themeToCssVars', () => {
  it('returns an empty map when no theme is provided', () => {
    expect(themeToCssVars()).toEqual({});
    expect(themeToCssVars({})).toEqual({});
  });

  it('emits only the tokens that are provided (sparse)', () => {
    const vars = themeToCssVars({ colors: { primary: '#e11d48' } });
    expect(vars).toEqual({ '--pacto-color-primary': '#e11d48' });
  });

  it('maps nested tokens to their CSS variable names', () => {
    const vars = themeToCssVars({
      colors: { primary: '#111', surface: '#fff' },
      typography: { fontFamily: 'Inter' },
      radius: '4px',
      spacing: '2rem',
    });
    expect(vars).toEqual({
      '--pacto-color-primary': '#111',
      '--pacto-color-surface': '#fff',
      '--pacto-font-family': 'Inter',
      '--pacto-radius': '4px',
      '--pacto-space': '2rem',
    });
  });

  it('ignores undefined token values', () => {
    const vars = themeToCssVars({ colors: { primary: undefined, text: '#000' } });
    expect(vars).toEqual({ '--pacto-color-text': '#000' });
  });
});

describe('buildCheckoutStylesheet', () => {
  it('references the pacto CSS variables with DEFAULT_THEME fallbacks', () => {
    const css = buildCheckoutStylesheet();
    expect(css).toContain('.pacto-checkout-overlay');
    expect(css).toContain(`var(--pacto-color-primary, ${DEFAULT_THEME.colors.primary})`);
    expect(css).toContain(`var(--pacto-color-surface, ${DEFAULT_THEME.colors.surface})`);
    expect(css).toContain('var(--pacto-radius,');
    expect(css).toContain('.pacto-checkout-logo');
  });

  it('only references the primary color via var() fallbacks, never as a bare literal', () => {
    const css = buildCheckoutStylesheet();
    const occurrences = css.split(DEFAULT_THEME.colors.primary).length - 1;
    // Once for the button background, once for the focus-visible outline —
    // both are `var(--pacto-color-primary, <default>)` fallbacks, not bare literals.
    expect(occurrences).toBe(2);
    const fallbackOccurrences = css.split(`, ${DEFAULT_THEME.colors.primary})`).length - 1;
    expect(fallbackOccurrences).toBe(occurrences);
  });
});

describe('STYLE_ELEMENT_ID', () => {
  it('is the shared style element id', () => {
    expect(STYLE_ELEMENT_ID).toBe('pacto-checkout-styles');
  });
});

describe('buildCheckoutStylesheet accessibility rules', () => {
  it('defines a visually-hidden utility class for live-region announcements', () => {
    const css = buildCheckoutStylesheet();
    expect(css).toContain('.pacto-checkout-sr-only');
    expect(css).toContain('clip: rect(0, 0, 0, 0)');
  });

  it('defines a visible, non-suppressed focus-visible outline for interactive controls', () => {
    const css = buildCheckoutStylesheet();
    expect(css).toContain(':focus-visible');
    expect(css).not.toMatch(/outline:\s*none/);
    expect(css).not.toMatch(/outline:\s*0[^.]/);
  });
});

describe('resolveTheme', () => {
  it('returns DEFAULT_THEME unchanged when no override is given', () => {
    expect(resolveTheme()).toEqual(DEFAULT_THEME);
    expect(resolveTheme({})).toEqual(DEFAULT_THEME);
  });

  it('deep-merges color and typography overrides onto the defaults', () => {
    const resolved = resolveTheme({ colors: { primary: '#111111' }, radius: '4px' });
    expect(resolved.colors.primary).toBe('#111111');
    expect(resolved.colors.surface).toBe(DEFAULT_THEME.colors.surface);
    expect(resolved.radius).toBe('4px');
    expect(resolved.typography).toEqual(DEFAULT_THEME.typography);
  });
});

describe('validateThemeContrast', () => {
  it('reports no issues for the default theme', () => {
    expect(validateThemeContrast()).toEqual([]);
  });

  it('reports a failing pair for a theme with insufficient contrast', () => {
    const issues = validateThemeContrast({
      colors: { text: '#ffffff', surface: '#ffffff' },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      pair: 'colors.text on colors.surface',
      foreground: '#ffffff',
      background: '#ffffff',
      ratio: 1,
      minimumRatio: 4.5,
      level: 'AA',
    });
  });

  it('reports every failing pair, not just the first', () => {
    const issues = validateThemeContrast({
      colors: { text: '#ffffff', surface: '#ffffff', danger: '#fecaca' },
    });

    const pairs = issues.map((issue) => issue.pair);
    expect(pairs).toContain('colors.text on colors.surface');
    expect(pairs).toContain('colors.danger on colors.surface');
  });

  it('skips a pair whose color cannot be parsed instead of guessing', () => {
    const issues = validateThemeContrast({
      colors: { text: 'hsl(0, 0%, 100%)', surface: '#ffffff' },
    });
    expect(issues.find((issue) => issue.pair === 'colors.text on colors.surface')).toBeUndefined();
  });

  it('accepts 3- and 8-digit hex colors', () => {
    expect(validateThemeContrast({ colors: { text: '#fff', surface: '#fff' } })).toHaveLength(1);
    expect(
      validateThemeContrast({ colors: { text: '#ffffffff', surface: '#ffffffff' } }),
    ).toHaveLength(1);
  });
});

describe('formatThemeContrastWarning', () => {
  it('names the failing pair and both ratios', () => {
    const issues = validateThemeContrast({ colors: { text: '#ffffff', surface: '#ffffff' } });
    const message = formatThemeContrastWarning(issues);

    expect(message).toContain('colors.text on colors.surface');
    expect(message).toContain('1:1');
    expect(message).toContain('4.5:1');
    expect(message).toContain('WCAG AA');
  });
});

describe('warnOnThemeContrastIssues', () => {
  it('does not warn for a passing theme', () => {
    const warn = vi.fn();
    const issues = warnOnThemeContrastIssues(undefined, warn);
    expect(warn).not.toHaveBeenCalled();
    expect(issues).toEqual([]);
  });

  it('warns with a message naming the failing pair for a deliberately failing theme', () => {
    const warn = vi.fn();
    const issues = warnOnThemeContrastIssues(
      { colors: { text: '#ffffff', surface: '#ffffff' } },
      warn,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('colors.text on colors.surface');
    expect(issues).toHaveLength(1);
  });

  it('defaults to console.warn when no warn function is provided', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnThemeContrastIssues({ colors: { text: '#ffffff', surface: '#ffffff' } });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
