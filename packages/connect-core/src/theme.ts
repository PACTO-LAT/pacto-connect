/**
 * White-label theming for the checkout widget.
 *
 * Design tokens are exposed as CSS custom properties under the `--pacto-*`
 * namespace. `DEFAULT_THEME` is the single source of truth for default values;
 * the stylesheet references each token with the default baked in as the var()
 * fallback, so merchants can override any subset via `themeToCssVars` (inline
 * vars) or by setting the CSS variables directly in their own stylesheet.
 */

export interface PactoTheme {
  colors: {
    primary: string;
    primaryText: string;
    surface: string;
    text: string;
    mutedText: string;
    border: string;
    overlay: string;
    danger: string;
  };
  typography: {
    fontFamily: string;
    fontSize: string;
    headingSize: string;
  };
  radius: string;
  spacing: string;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const STYLE_ELEMENT_ID = 'pacto-checkout-styles';

/** WCAG level this SDK validates theme colors against. Large-text pairs are not distinguished. */
export const CONTRAST_LEVEL = 'AA' as const;

export const DEFAULT_THEME: PactoTheme = {
  colors: {
    primary: '#4f46e5',
    primaryText: '#ffffff',
    surface: '#ffffff',
    text: '#0f172a',
    mutedText: '#475569',
    border: '#cbd5e1',
    overlay: 'rgba(15, 23, 42, 0.55)',
    danger: '#b91c1c',
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: '0.875rem',
    headingSize: '1.125rem',
  },
  radius: '0.75rem',
  spacing: '1.5rem',
};

/** Maps a token path to its CSS custom-property name. */
const CSS_VAR_MAP = {
  'colors.primary': '--pacto-color-primary',
  'colors.primaryText': '--pacto-color-primary-text',
  'colors.surface': '--pacto-color-surface',
  'colors.text': '--pacto-color-text',
  'colors.mutedText': '--pacto-color-muted-text',
  'colors.border': '--pacto-color-border',
  'colors.overlay': '--pacto-color-overlay',
  'colors.danger': '--pacto-color-danger',
  'typography.fontFamily': '--pacto-font-family',
  'typography.fontSize': '--pacto-font-size',
  'typography.headingSize': '--pacto-font-heading-size',
  radius: '--pacto-radius',
  spacing: '--pacto-space',
} as const;

/**
 * Convert a (partial) theme into a sparse map of CSS custom properties. Only
 * tokens that are explicitly provided are emitted; everything else falls
 * through to the stylesheet's built-in fallbacks.
 */
export function themeToCssVars(theme?: DeepPartial<PactoTheme>): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!theme) {
    return vars;
  }

  const colors = theme.colors ?? {};
  const typography = theme.typography ?? {};

  const assign = (path: keyof typeof CSS_VAR_MAP, value: string | undefined) => {
    if (typeof value === 'string') {
      vars[CSS_VAR_MAP[path]] = value;
    }
  };

  assign('colors.primary', colors.primary);
  assign('colors.primaryText', colors.primaryText);
  assign('colors.surface', colors.surface);
  assign('colors.text', colors.text);
  assign('colors.mutedText', colors.mutedText);
  assign('colors.border', colors.border);
  assign('colors.overlay', colors.overlay);
  assign('colors.danger', colors.danger);
  assign('typography.fontFamily', typography.fontFamily);
  assign('typography.fontSize', typography.fontSize);
  assign('typography.headingSize', typography.headingSize);
  assign('radius', theme.radius);
  assign('spacing', theme.spacing);

  return vars;
}

/**
 * Merge a (partial) theme onto `DEFAULT_THEME`, producing the fully resolved
 * token set the widget will actually render with. Used by contrast validation,
 * which needs concrete colors rather than the sparse overrides `themeToCssVars`
 * emits.
 */
export function resolveTheme(theme?: DeepPartial<PactoTheme>): PactoTheme {
  return {
    colors: { ...DEFAULT_THEME.colors, ...theme?.colors },
    typography: { ...DEFAULT_THEME.typography, ...theme?.typography },
    radius: theme?.radius ?? DEFAULT_THEME.radius,
    spacing: theme?.spacing ?? DEFAULT_THEME.spacing,
  };
}

/**
 * One color pair the widget actually renders text-on-background with. Kept in
 * sync by hand with `buildCheckoutStylesheet` — if a new themable text/surface
 * combination is introduced there, add it here too.
 */
interface ContrastPairDefinition {
  pair: string;
  foreground: keyof PactoTheme['colors'];
  background: keyof PactoTheme['colors'];
  /** WCAG 2.1 AA minimum for normal-weight text below 18pt/14pt-bold. */
  minimumRatio: number;
}

const CONTRAST_PAIRS: readonly ContrastPairDefinition[] = [
  {
    pair: 'colors.text on colors.surface',
    foreground: 'text',
    background: 'surface',
    minimumRatio: 4.5,
  },
  {
    pair: 'colors.mutedText on colors.surface',
    foreground: 'mutedText',
    background: 'surface',
    minimumRatio: 4.5,
  },
  {
    pair: 'colors.primaryText on colors.primary',
    foreground: 'primaryText',
    background: 'primary',
    minimumRatio: 4.5,
  },
  {
    pair: 'colors.danger on colors.surface',
    foreground: 'danger',
    background: 'surface',
    minimumRatio: 4.5,
  },
];

export interface ThemeContrastIssue {
  /** Human-readable name of the failing pair, e.g. "colors.text on colors.surface". */
  pair: string;
  foreground: string;
  background: string;
  /** Measured contrast ratio, rounded to 2 decimal places. */
  ratio: number;
  /** WCAG AA minimum ratio required for this pair. */
  minimumRatio: number;
  level: typeof CONTRAST_LEVEL;
}

type Rgb = readonly [number, number, number];

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Returns `null` for anything else
 * (named colors, `hsl()`, CSS variables) rather than guessing — an unparseable color is skipped
 * rather than falsely reported as passing or failing. */
function parseColor(value: string): Rgb | null {
  const hex = value.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length === 3) {
      digits = digits
        .split('')
        .map((d) => d + d)
        .join('');
    }
    const r = Number.parseInt(digits.slice(0, 2), 16);
    const g = Number.parseInt(digits.slice(2, 4), 16);
    const b = Number.parseInt(digits.slice(4, 6), 16);
    return [r, g, b];
  }

  const fn = value.trim().match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (fn) {
    return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  }

  return null;
}

/** WCAG relative luminance, per https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (c: number): number => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors, per https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Checks every themable text/background color pair the checkout dialog
 * renders against WCAG 2.1 AA. Call this wherever a theme is configured
 * (widget mount, `pacto.mount()`, etc.) so a merchant sees the problem at
 * configuration time rather than a user discovering it can't be read.
 *
 * A pair whose colors can't be parsed (e.g. a named CSS color or `hsl()`) is
 * skipped rather than reported, since we can't compute a ratio for it.
 */
export function validateThemeContrast(theme?: DeepPartial<PactoTheme>): ThemeContrastIssue[] {
  const resolved = resolveTheme(theme);
  const issues: ThemeContrastIssue[] = [];

  for (const def of CONTRAST_PAIRS) {
    const foreground = resolved.colors[def.foreground];
    const background = resolved.colors[def.background];
    const fg = parseColor(foreground);
    const bg = parseColor(background);
    if (!fg || !bg) {
      continue;
    }

    const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
    if (ratio < def.minimumRatio) {
      issues.push({
        pair: def.pair,
        foreground,
        background,
        ratio,
        minimumRatio: def.minimumRatio,
        level: CONTRAST_LEVEL,
      });
    }
  }

  return issues;
}

/** Formats `validateThemeContrast` issues into one multi-line, human-readable warning. */
export function formatThemeContrastWarning(issues: ThemeContrastIssue[]): string {
  const lines = issues.map(
    (issue) =>
      `  - ${issue.pair}: ${issue.foreground} on ${issue.background} is ${issue.ratio}:1, ` +
      `WCAG ${issue.level} requires at least ${issue.minimumRatio}:1`,
  );
  return (
    `[pacto-connect] Theme fails WCAG ${CONTRAST_LEVEL} contrast for ${issues.length} ` +
    `color pair${issues.length === 1 ? '' : 's'}:\n${lines.join('\n')}`
  );
}

/**
 * Validates `theme` and reports any WCAG AA contrast failures via `warn`
 * (defaults to `console.warn`). Called by every widget surface as soon as a
 * theme is configured. Returns the issues so callers that want to fail loudly
 * (e.g. a CI theme-lint script) can inspect them instead of just logging.
 */
export function warnOnThemeContrastIssues(
  theme?: DeepPartial<PactoTheme>,
  warn: (message: string) => void = (message) => {
    console.warn(message);
  },
): ThemeContrastIssue[] {
  const issues = validateThemeContrast(theme);
  if (issues.length > 0) {
    warn(formatThemeContrastWarning(issues));
  }
  return issues;
}

/**
 * The default checkout stylesheet, tokenized. Every themeable value is written
 * as `var(--pacto-*, <default>)` where the default comes from DEFAULT_THEME, so
 * there is exactly one source for each default literal.
 */
export function buildCheckoutStylesheet(): string {
  const c = DEFAULT_THEME.colors;
  const t = DEFAULT_THEME.typography;
  const radius = `var(--pacto-radius, ${DEFAULT_THEME.radius})`;
  const controlRadius = `calc(${radius} - 0.25rem)`;

  return `
.pacto-checkout-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: var(--pacto-color-overlay, ${c.overlay});
  z-index: 2147483647;
}

.pacto-checkout-dialog {
  width: 100%;
  max-width: 24rem;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  padding: var(--pacto-space, ${DEFAULT_THEME.spacing});
  border-radius: ${radius};
  background: var(--pacto-color-surface, ${c.surface});
  color: var(--pacto-color-text, ${c.text});
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
  font-family: var(--pacto-font-family, ${t.fontFamily});
  font-size: var(--pacto-font-size, ${t.fontSize});
}

.pacto-checkout-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.pacto-checkout-heading {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.pacto-checkout-logo {
  max-height: 2rem;
  width: auto;
}

.pacto-checkout-header h2 {
  margin: 0;
  font-size: var(--pacto-font-heading-size, ${t.headingSize});
  font-weight: 600;
}

.pacto-checkout-dialog button {
  cursor: pointer;
  border-radius: ${controlRadius};
  border: 1px solid transparent;
  background: var(--pacto-color-primary, ${c.primary});
  color: var(--pacto-color-primary-text, ${c.primaryText});
  padding: 0.5rem 0.875rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.pacto-checkout-header button {
  margin-left: auto;
  background: transparent;
  color: var(--pacto-color-muted-text, ${c.mutedText});
  border-color: var(--pacto-color-border, ${c.border});
  padding: 0.25rem 0.625rem;
}

.pacto-checkout-dialog ul,
.pacto-checkout-dialog ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.pacto-checkout-dialog form {
  display: grid;
  gap: 0.75rem;
}

.pacto-checkout-dialog label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.875rem;
}

.pacto-checkout-dialog input,
.pacto-checkout-dialog select {
  width: 100%;
  padding: 0.5rem 0.625rem;
  border-radius: ${controlRadius};
  border: 1px solid var(--pacto-color-border, ${c.border});
  font-size: 0.875rem;
}

.pacto-checkout-dialog [data-testid="checkout-error"] {
  color: var(--pacto-color-danger, ${c.danger});
}

.pacto-checkout-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Always-visible, never-suppressed focus indicator. Uses the theme's primary
   color so it stays legible against a merchant's own surface color. */
.pacto-checkout-dialog button:focus-visible,
.pacto-checkout-dialog a:focus-visible,
.pacto-checkout-dialog input:focus-visible,
.pacto-checkout-dialog select:focus-visible,
.pacto-checkout-dialog [tabindex]:focus-visible {
  outline: 2px solid var(--pacto-color-primary, ${c.primary});
  outline-offset: 2px;
}

.pacto-checkout-test-banner {
  margin: -1.5rem -1.5rem 1rem;
  padding: 0.625rem 1rem;
  border-radius: ${radius} ${radius} 0 0;
  background: #fef3c7;
  color: #92400e;
  border-bottom: 1px solid #fcd34d;
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: center;
  letter-spacing: 0.02em;
}

.pacto-checkout-simulator-controls {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--pacto-color-border, ${c.border});
  display: grid;
  gap: 0.5rem;
}

.pacto-checkout-simulator-controls p {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--pacto-color-muted-text, ${c.mutedText});
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pacto-checkout-simulator-controls button {
  background: #f59e0b;
  border-color: #d97706;
}

.pacto-checkout-simulator-controls button:hover {
  background: #d97706;
}
`;
}
