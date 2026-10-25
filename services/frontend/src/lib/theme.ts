/**
 * Deploy-time UI theming: turn the single-hex knobs in `config.theme` into full
 * color ramps for the design system and apply them as CSS custom-property
 * overrides.
 *
 * The design system (@mattilsynet/design) exposes ~144
 * `--mtds-color-*` variables, organised into families (`main`, `info`,
 * `success`, `danger`, `warning`) plus global neutrals (`background`, `surface`,
 * `text`, `border`, `base`). Each family has 16 variants. It also ships a full
 * dark theme keyed by `[data-color-scheme=dark]` / `prefers-color-scheme: dark`.
 *
 * Rather than override variables inline on `documentElement` (which can't tell
 * light from dark and would clobber the dark palette), we generate a single
 * stylesheet with scheme-scoped blocks and inject it. `THEME_PRIMARY` drives the
 * brand (`main`) AND interactive (`info`) families in both schemes; optional
 * status knobs drive their families; optional neutral knobs override the global
 * tokens (light scheme only — dark keeps the tuned mtds neutrals).
 *
 * See lib/mapColors.ts for the separate, JS-set Leaflet geometry colors.
 */
import type { ThemeColors } from './mapColors';

const HEX6 = /^#([0-9a-fA-F]{6})$/;

export function isHex(hex: string): boolean {
  return typeof hex === 'string' && HEX6.test(hex);
}

function toRgb(hex: string): [number, number, number] | null {
  const m = HEX6.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1)}`;
}

/** Darken toward black by `amount` (0..1). Returns the input on a parse failure. */
export function darken(hex: string, amount = 0.35): string {
  const rgb = toRgb(hex);
  if (!rgb) return hex;
  return toHex(rgb[0] * (1 - amount), rgb[1] * (1 - amount), rgb[2] * (1 - amount));
}

/** Lighten toward white by `amount` (0..1). Returns the input on a parse failure. */
export function lighten(hex: string, amount = 0.35): string {
  const rgb = toRgb(hex);
  if (!rgb) return hex;
  return toHex(
    rgb[0] + (255 - rgb[0]) * amount,
    rgb[1] + (255 - rgb[1]) * amount,
    rgb[2] + (255 - rgb[2]) * amount
  );
}

/** Linear blend of `hex` toward `other` by `amount` (0..1). Input on failure. */
export function mix(hex: string, other: string, amount: number): string {
  const a = toRgb(hex);
  const b = toRgb(other);
  if (!a || !b) return hex;
  return toHex(
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  );
}

/** WCAG relative luminance (0..1). */
export function relativeLuminance(hex: string): number {
  const rgb = toRgb(hex);
  if (!rgb) return 0;
  const lin = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Readable text/icon color (white or near-black) to sit on top of `hex`. */
export function contrastColor(hex: string): string {
  return relativeLuminance(hex) < 0.5 ? '#ffffff' : '#1a1a1a';
}

export type Ramp = Record<string, string>;
export type Scheme = 'light' | 'dark';

const NEAR_BLACK = '#0b0b0b';

/**
 * Derive a full 16-variant design-system ramp from a single hex, for the given
 * color scheme. Light surfaces are near-white with a hue-tinted accent; dark
 * surfaces are hue-mixed near-black with a lightened accent that pops on dark.
 * Returns `{}` for an invalid hex. Values are anchored to the real mtds ramps;
 * exact percentages are tunable (tests assert relationships, not literals).
 */
export function deriveRamp(hex: string, scheme: Scheme): Ramp {
  if (!isHex(hex)) return {};
  const p = hex.toLowerCase();

  if (scheme === 'dark') {
    const base = lighten(p, 0.35);
    return {
      'base-default': base,
      'base-hover': lighten(p, 0.5),
      'base-active': lighten(p, 0.65),
      'base-contrast-default': contrastColor(base),
      'base-contrast-subtle': darken(p, 0.6),
      'border-subtle': '#ffffff33',
      'border-default': mix(p, '#ffffff', 0.4),
      'border-strong': lighten(p, 0.35),
      'surface-default': mix(p, NEAR_BLACK, 0.85),
      'surface-tinted': mix(p, NEAR_BLACK, 0.8),
      'surface-hover': mix(p, NEAR_BLACK, 0.68),
      'surface-active': mix(p, NEAR_BLACK, 0.6),
      'text-subtle': lighten(p, 0.55),
      'text-default': lighten(p, 0.7),
      'background-default': mix(p, NEAR_BLACK, 0.9),
      'background-tinted': '#ffffff0a'
    };
  }

  return {
    'base-default': p,
    'base-hover': darken(p, 0.25),
    'base-active': darken(p, 0.45),
    'base-contrast-default': contrastColor(p),
    'base-contrast-subtle': mix(p, '#ffffff', 0.85),
    'border-subtle': `${p}26`,
    'border-default': darken(p, 0.25),
    'border-strong': darken(p, 0.45),
    'surface-default': '#ffffff',
    'surface-tinted': mix(p, '#ffffff', 0.86),
    'surface-hover': mix(p, '#ffffff', 0.8),
    'surface-active': mix(p, '#ffffff', 0.72),
    'text-subtle': p,
    'text-default': darken(p, 0.25),
    'background-default': '#faf7f4',
    'background-tinted': `${p}14`
  };
}

/** Global neutral tokens (no family prefix), derived from a single hex. */
function neutralLines(theme: ThemeColors): string[] {
  const lines: string[] = [];
  const surface = theme.surface;
  if (surface && isHex(surface)) {
    lines.push(
      `--mtds-color-surface-default: ${surface};`,
      `--mtds-color-surface-hover: ${darken(surface, 0.05)};`,
      `--mtds-color-surface-active: ${darken(surface, 0.1)};`,
      `--mtds-color-surface-tinted: ${darken(surface, 0.03)};`
    );
  }
  const background = theme.background;
  if (background && isHex(background)) {
    lines.push(
      `--mtds-color-background-default: ${background};`,
      `--mtds-color-background-tinted: ${background}0f;`
    );
  }
  const text = theme.text;
  if (text && isHex(text)) {
    lines.push(
      `--mtds-color-text-default: ${text};`,
      `--mtds-color-text-subtle: ${lighten(text, 0.3)};`
    );
  }
  const border = theme.border;
  if (border && isHex(border)) {
    lines.push(
      `--mtds-color-border-default: ${border};`,
      `--mtds-color-border-strong: ${darken(border, 0.25)};`,
      `--mtds-color-border-subtle: ${border}40;`
    );
  }
  return lines;
}

function rampLines(family: string, ramp: Ramp): string[] {
  return Object.entries(ramp).map(([suffix, value]) => `--mtds-color-${family}-${suffix}: ${value};`);
}

/** Single-hex knob → mtds family/families it overrides. */
const FAMILY_KNOBS: Array<[keyof ThemeColors, string[]]> = [
  ['primary', ['main', 'info']],
  ['success', ['success']],
  ['danger', ['danger']],
  ['warning', ['warning']]
];

/**
 * Build a stylesheet (as a string) of `--mtds-color-*` overrides from a theme.
 * Family knobs are emitted in both light (`:root`) and dark
 * (`[data-color-scheme=dark]` + a `prefers-color-scheme: dark` query covering
 * the `auto` case) scopes. Neutral knobs are emitted only for an explicit
 * light choice and for system-light under `auto`, never in a bare `:root`.
 * Returns an empty string when there is nothing to emit.
 */
export function buildThemeCss(theme: ThemeColors | undefined | null): string {
  if (!theme || typeof theme !== 'object') return '';

  const light: string[] = [];
  const dark: string[] = [];

  for (const [key, families] of FAMILY_KNOBS) {
    const value = theme[key];
    if (typeof value !== 'string' || !isHex(value)) continue;
    const lightRamp = deriveRamp(value, 'light');
    const darkRamp = deriveRamp(value, 'dark');
    for (const family of families) {
      light.push(...rampLines(family, lightRamp));
      dark.push(...rampLines(family, darkRamp));
    }
  }

  // Neutral knobs have no dark counterpart, so they must only apply while the
  // page is actually light. The injected sheet is unlayered and therefore
  // beats the design system's layered dark tokens; an unscoped :root would
  // paint light surfaces onto the dark scheme.
  const neutral = neutralLines(theme);

  let css = '';
  if (light.length) css += `:root{${light.join('')}}`;
  if (dark.length) {
    const block = dark.join('');
    css += `[data-color-scheme=dark]{${block}}`;
    css += `@media (prefers-color-scheme: dark){:root:not([data-color-scheme=light]){${block}}}`;
  }
  if (neutral.length) {
    const block = neutral.join('');
    css += `[data-color-scheme=light]{${block}}`;
    css += `@media (prefers-color-scheme: light){:root:not([data-color-scheme=dark]){${block}}}`;
  }
  return css;
}

const STYLE_ID = 'app-theme';

/**
 * Apply UI theme overrides by injecting/updating a single `<style id="app-theme">`
 * element with {@link buildThemeCss}. No-op when there is nothing to apply or no
 * DOM is available. Safe to call repeatedly (replaces, never duplicates).
 */
export function applyUiTheme(theme: ThemeColors | undefined | null): void {
  if (typeof document === 'undefined') return;
  const css = buildThemeCss(theme);
  const existing = document.getElementById(STYLE_ID);
  if (!css) {
    existing?.remove();
    return;
  }
  const style = existing ?? document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  if (!existing) document.head.appendChild(style);
}
