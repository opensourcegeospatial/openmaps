import { describe, it, expect, beforeEach } from 'vitest';
import {
  isHex,
  darken,
  lighten,
  mix,
  relativeLuminance,
  contrastColor,
  deriveRamp,
  buildThemeCss,
  applyUiTheme
} from './theme';

const val = (hex: string) => parseInt(hex.slice(1, 7), 16);

describe('color primitives', () => {
  it('isHex accepts 6-digit hex only', () => {
    expect(isHex('#0a84ff')).toBe(true);
    expect(isHex('#FFF')).toBe(false);
    expect(isHex('0a84ff')).toBe(false);
    expect(isHex('not-a-color')).toBe(false);
  });

  it('darken returns a darker 6-digit hex', () => {
    const out = darken('#808080', 0.5);
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(val(out)).toBeLessThan(0x808080);
  });

  it('lighten returns a lighter hex than the input', () => {
    expect(val(lighten('#808080', 0.5))).toBeGreaterThan(0x808080);
  });

  it('mix interpolates between two colors', () => {
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('relativeLuminance: white ~1, black ~0', () => {
    expect(relativeLuminance('#ffffff')).toBeGreaterThan(0.99);
    expect(relativeLuminance('#000000')).toBeLessThan(0.01);
  });

  it('contrastColor picks white on dark colors, dark on light colors', () => {
    expect(contrastColor('#0c4fa1')).toBe('#ffffff');
    expect(contrastColor('#ffe600')).not.toBe('#ffffff');
  });

  it('invalid input falls back to the input string', () => {
    expect(darken('bogus')).toBe('bogus');
    expect(lighten('bogus')).toBe('bogus');
    expect(mix('bogus', '#fff', 0.5)).toBe('bogus');
  });
});

describe('deriveRamp', () => {
  const EXPECTED_SUFFIXES = [
    'background-default',
    'background-tinted',
    'base-active',
    'base-contrast-default',
    'base-contrast-subtle',
    'base-default',
    'base-hover',
    'border-default',
    'border-strong',
    'border-subtle',
    'surface-active',
    'surface-default',
    'surface-hover',
    'surface-tinted',
    'text-default',
    'text-subtle'
  ];

  it('returns all 16 variant suffixes for both modes', () => {
    expect(Object.keys(deriveRamp('#0c4fa1', 'light')).sort()).toEqual([...EXPECTED_SUFFIXES].sort());
    expect(Object.keys(deriveRamp('#0c4fa1', 'dark')).sort()).toEqual([...EXPECTED_SUFFIXES].sort());
  });

  it('returns {} for an invalid hex', () => {
    expect(deriveRamp('nope', 'light')).toEqual({});
  });

  describe('light mode', () => {
    const r = deriveRamp('#0c4fa1', 'light');
    it('base-default equals the input', () => expect(r['base-default']).toBe('#0c4fa1'));
    it('hover darker than default, active darker than hover', () => {
      expect(val(r['base-hover'])).toBeLessThan(val(r['base-default']));
      expect(val(r['base-active'])).toBeLessThan(val(r['base-hover']));
    });
    it('surface is near-white and tinted is lighter than active', () => {
      expect(r['surface-default']).toBe('#ffffff');
      expect(val(r['surface-tinted'])).toBeGreaterThan(val(r['surface-active']));
    });
    it('contrast on a dark brand is white', () => {
      expect(r['base-contrast-default']).toBe('#ffffff');
    });
    it('subtle border/background carry alpha (8-digit hex)', () => {
      expect(r['border-subtle']).toMatch(/^#[0-9a-f]{8}$/);
      expect(r['background-tinted']).toMatch(/^#[0-9a-f]{8}$/);
    });
  });

  describe('dark mode', () => {
    const light = deriveRamp('#0c4fa1', 'light');
    const dark = deriveRamp('#0c4fa1', 'dark');
    it('accent base is lighter than in light mode (pops on dark)', () => {
      expect(val(dark['base-default'])).toBeGreaterThan(val(light['base-default']));
    });
    it('surfaces are dark; background darker than surface', () => {
      expect(val(dark['surface-default'])).toBeLessThan(val(light['surface-default']));
      expect(val(dark['background-default'])).toBeLessThan(val(dark['surface-default']));
    });
    it('text is lighter than the surface it sits on', () => {
      expect(val(dark['text-default'])).toBeGreaterThan(val(dark['surface-default']));
    });
    it('contrast tracks the dark accent base for readability', () => {
      expect(dark['base-contrast-default']).toBe(contrastColor(dark['base-default']));
      expect(['#ffffff', '#1a1a1a']).toContain(dark['base-contrast-default']);
    });
  });
});

describe('buildThemeCss', () => {
  it('returns empty string for empty / invalid theme', () => {
    expect(buildThemeCss(undefined)).toBe('');
    expect(buildThemeCss({})).toBe('');
    expect(buildThemeCss({ primary: 'bogus' })).toBe('');
  });

  it('primary emits both main and info families in a :root (light) block', () => {
    const css = buildThemeCss({ primary: '#0c4fa1' });
    expect(css).toContain(':root');
    expect(css).toContain('--mtds-color-main-base-default: #0c4fa1');
    expect(css).toContain('--mtds-color-info-base-default: #0c4fa1');
  });

  it('emits a dark block and a prefers-color-scheme media query', () => {
    const css = buildThemeCss({ primary: '#0c4fa1' });
    expect(css).toContain('[data-color-scheme=dark]');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-color-scheme=light])');
  });

  it('status knobs emit their families', () => {
    const css = buildThemeCss({ danger: '#ff00ff' });
    expect(css).toContain('--mtds-color-danger-base-default: #ff00ff');
  });

  it('neutral knobs never appear inside a dark-scheme block', () => {
    const css = buildThemeCss({ surface: '#5f5f5f', primary: '#0c4fa1' });
    expect(css).toContain('--mtds-color-surface-default: #5f5f5f');
    // Every block scoped to the dark scheme must be free of the neutral override.
    const darkBlocks = [
      ...css.matchAll(/\[data-color-scheme=dark\]\{[^}]*\}/g),
      ...css.matchAll(/:root:not\(\[data-color-scheme=light\]\)\{[^}]*\}/g)
    ];
    expect(darkBlocks.length).toBeGreaterThan(0);
    for (const block of darkBlocks) {
      expect(block[0]).not.toContain('--mtds-color-surface-default');
    }
  });
});

describe('applyUiTheme', () => {
  const styleEl = () => document.getElementById('app-theme');

  beforeEach(() => {
    styleEl()?.remove();
  });

  it('is a no-op for empty / invalid input', () => {
    applyUiTheme(undefined);
    applyUiTheme({});
    expect(styleEl()).toBeNull();
  });

  it('injects a single <style id="app-theme"> with the generated CSS', () => {
    applyUiTheme({ primary: '#0c4fa1' });
    const el = styleEl();
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe('STYLE');
    expect(el!.textContent).toContain('--mtds-color-main-base-default: #0c4fa1');
  });

  it('replaces (does not duplicate) the style element on re-call', () => {
    applyUiTheme({ primary: '#0c4fa1' });
    applyUiTheme({ primary: '#7c3aed' });
    expect(document.querySelectorAll('#app-theme')).toHaveLength(1);
    expect(styleEl()!.textContent).toContain('#7c3aed');
    expect(styleEl()!.textContent).not.toContain('#0c4fa1');
  });
});

describe('buildThemeCss neutral knobs and dark mode', () => {
  it('never emits neutral tokens in an unscoped :root block (they would override the dark scheme)', () => {
    const css = buildThemeCss({ surface: '#f4f4f5', text: '#17211e' });
    // Every :root{...} block that carries a neutral token must be light-scoped.
    const unscopedRoot = css.match(/(^|[};])\s*:root\{[^}]*--mtds-color-surface-default[^}]*\}/);
    expect(unscopedRoot).toBeNull();
    expect(css).toContain('--mtds-color-surface-default: #f4f4f5;');
  });

  it('applies neutral tokens for an explicit light choice and for system-light under auto', () => {
    const css = buildThemeCss({ surface: '#f4f4f5' });
    expect(css).toMatch(/\[data-color-scheme=light\]\{[^}]*--mtds-color-surface-default: #f4f4f5;/);
    expect(css).toMatch(
      /@media \(prefers-color-scheme: light\)\{:root:not\(\[data-color-scheme=dark\]\)\{[^}]*--mtds-color-surface-default: #f4f4f5;/
    );
  });
});
