import { describe, it, expect, beforeEach } from 'vitest';
import { mapColors, applyTheme, type ThemeColors } from './mapColors';

// Snapshot of the default values so each test starts from a known baseline
// (applyTheme mutates the shared mapColors object in place by design).
const DEFAULTS = { ...mapColors };

beforeEach(() => {
  Object.assign(mapColors, DEFAULTS);
});

describe('applyTheme', () => {
  it('is a no-op for undefined / null / non-object input', () => {
    applyTheme(undefined);
    applyTheme(null);
    // @ts-expect-error — deliberately wrong type to exercise the guard
    applyTheme('nope');
    expect(mapColors.routePrimary).toBe(DEFAULTS.routePrimary);
  });

  it('overrides routePrimary and the connector that shares it', () => {
    applyTheme({ routePrimary: '#123456' });
    expect(mapColors.routePrimary).toBe('#123456');
    expect(mapColors.routeConnector).toBe('#123456');
  });

  it('overrides routeAlternative and markers', () => {
    applyTheme({
      routeAlternative: '#aaaaaa',
      markerFrom: '#00ff00',
      markerTo: '#ff0000',
      markerWaypoint: '#0000ff'
    });
    expect(mapColors.routeAlternative).toBe('#aaaaaa');
    expect(mapColors.markerFrom).toBe('#00ff00');
    expect(mapColors.markerTo).toBe('#ff0000');
    expect(mapColors.markerWaypoint).toBe('#0000ff');
  });

  it('maps avoid → fill + stroke + a darker vertex stroke', () => {
    applyTheme({ avoid: '#c83719' });
    expect(mapColors.avoidFill).toBe('#c83719');
    expect(mapColors.avoidStroke).toBe('#c83719');
    // Derived stroke must differ (darker shade) from the fill.
    expect(mapColors.avoidVertexStroke).not.toBe('#c83719');
    expect(mapColors.avoidVertexStroke).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('maps featureSelected → selected* and feature* colors', () => {
    applyTheme({ featureSelected: '#0c4fa1' });
    expect(mapColors.selectedFill).toBe('#0c4fa1');
    expect(mapColors.featureFill).toBe('#0c4fa1');
    // Stroke/point derive a darker shade.
    expect(mapColors.selectedStroke).not.toBe('#0c4fa1');
    expect(mapColors.selectedPoint).toBe(mapColors.selectedStroke);
    expect(mapColors.featureStroke).toBe(mapColors.selectedStroke);
  });

  it('primary fills accent map colors when granular keys are unset', () => {
    applyTheme({ primary: '#0c4fa1' });
    expect(mapColors.routePrimary).toBe('#0c4fa1');
    expect(mapColors.routeConnector).toBe('#0c4fa1');
    expect(mapColors.markerFrom).toBe('#0c4fa1');
    expect(mapColors.selectedFill).toBe('#0c4fa1');
    expect(mapColors.featureFill).toBe('#0c4fa1');
    // Derived strong stroke differs from the fill.
    expect(mapColors.selectedStroke).not.toBe('#0c4fa1');
    // Semantic colors are NOT touched by primary.
    expect(mapColors.markerTo).toBe(DEFAULTS.markerTo);
    expect(mapColors.avoidFill).toBe(DEFAULTS.avoidFill);
    expect(mapColors.routeAlternative).toBe(DEFAULTS.routeAlternative);
  });

  it('granular keys override the primary fallback', () => {
    applyTheme({ primary: '#0c4fa1', routePrimary: '#123456', featureSelected: '#abcdef' });
    expect(mapColors.routePrimary).toBe('#123456');
    expect(mapColors.selectedFill).toBe('#abcdef');
  });

  it('ignores an invalid primary hex for map colors', () => {
    applyTheme({ primary: 'bogus' });
    expect(mapColors.routePrimary).toBe(DEFAULTS.routePrimary);
  });

  it('keeps defaults for keys that are absent', () => {
    applyTheme({ routePrimary: '#111111' });
    expect(mapColors.markerTo).toBe(DEFAULTS.markerTo);
    expect(mapColors.routeAlternative).toBe(DEFAULTS.routeAlternative);
  });

  it('ignores non-string values', () => {
    // @ts-expect-error — exercise runtime validation
    const theme: ThemeColors = { routePrimary: 123, markerFrom: null, markerTo: '' };
    applyTheme(theme);
    expect(mapColors.routePrimary).toBe(DEFAULTS.routePrimary);
    expect(mapColors.markerFrom).toBe(DEFAULTS.markerFrom);
    expect(mapColors.markerTo).toBe(DEFAULTS.markerTo);
  });
});
