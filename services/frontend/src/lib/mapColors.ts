/**
 * Centralized color palette for Leaflet/map geometry that is set imperatively
 * from JavaScript (route lines, markers, avoid-areas, measurement helpers,
 * streetview points, …).
 *
 * These are the single source of truth for JS-set map colors. The values are
 * pulled from the Mattilsynet design palette (@mattilsynet/design) so the map
 * geometry stays visually consistent with the surrounding chrome:
 *
 *   - success (teal/green)  → primary route, "from" marker
 *   - danger  (red)         → avoid-areas, "to" / destination marker
 *   - info    (blue)        → selection / hover / overpass features, measurement
 *   - neutral (grey)        → alternative (de-emphasised) route
 *   - peat (brown)          → imported file layers: the user's own data, like
 *                             the saved-place star, never a semantic map hue
 *
 * NOTE (documented follow-up): these are static light-theme hex literals. Full
 * dark-mode adaptivity would require reading the CSS custom properties
 * (e.g. `getComputedStyle(document.documentElement).getPropertyValue(...)`) at
 * runtime and re-styling the Leaflet layers on theme change. That is
 * intentionally out of scope here; the goal of this module is centralization +
 * palette consistency with the design tokens. Class-based chrome (everything
 * outside of Leaflet) already adapts to the theme via Tailwind tokens.
 */

// --- Design palette anchors (light theme) -----------------------------------
// Mapped 1:1 from the design tokens so the map matches the chrome.
const SUCCESS = '#116e6b'; // --mtds-color-success-base-default
const DANGER = '#c83719'; // --mtds-color-danger-base-default
const DANGER_STRONG = '#791111'; // --mtds-color-danger-border-strong
const INFO = '#0c4fa1'; // --mtds-color-info-base-default
const INFO_STRONG = '#103160'; // --mtds-color-info-base-active
const NEUTRAL = '#6b7280'; // de-emphasised grey for alternative routes
const PEAT = '#572f28'; // --mtds-color-warning-text-default (Peat Brown)
const HALO = '#ffffff'; // separates point markers from busy tiles

/** Map geometry colors, grouped by purpose. */
export const mapColors: Record<string, string> & MapColorsShape = {
  /** Primary (selected) route line — success/teal to match the chrome. */
  routePrimary: SUCCESS,
  /** Connector segment (click point → snapped point), drawn dashed. */
  routeConnector: SUCCESS,
  /** Alternative (secondary) route, de-emphasised grey + dashed. */
  routeAlternative: NEUTRAL,

  /** Selected feature outline / fill. */
  selectedStroke: INFO_STRONG,
  selectedFill: INFO,
  /** Selected point marker (circle). */
  selectedPoint: INFO_STRONG,

  /** Hovered feature outline / fill. */
  hoverStroke: INFO,
  hoverFill: INFO,
  hoverPoint: INFO_STRONG,

  /** Overpass result features outline / fill / point. */
  featureStroke: INFO_STRONG,
  featureFill: INFO,
  featurePoint: INFO_STRONG,

  /**
   * The extent an area search asked about, drawn as a hairline while its
   * answer stands. The hits' own colour, because the box and the dots are one
   * answer: "i kartutsnittet" names a rectangle the user could not see, and a
   * pan left fourteen confident rows over an empty map (critique run 16).
   */
  areaExtentStroke: INFO_STRONG,

  /**
   * Route details pointing at the map (the profile's dot, a category's
   * stretches): the selection colour, over the route, which dims meanwhile.
   */
  routeHighlight: INFO,

  /** White ring around point markers (selected, hovered, area-search hits). */
  pointHalo: HALO,

  /** Route stop marks on the map, drawn from these colours like the route panel's rows. */
  markerFrom: SUCCESS,
  markerTo: DANGER,
  markerWaypoint: INFO,

  /** Avoid-area (Unngå område) fill + stroke — danger/red. */
  avoidFill: DANGER,
  avoidStroke: DANGER,
  /** Vertex marker stroke while drawing an avoid-area. */
  avoidVertexStroke: DANGER_STRONG,

  /** Measurement helper geometry (lines, polygons, vertices) — info/blue. */
  measureStroke: INFO,
  measureFill: INFO,
  measureVertexFill: INFO,
  measureVertexStroke: INFO_STRONG,

  /**
   * Street-view points (fallback when config doesn't override): Fjord Teal,
   * because a point you can open is an action, and red means avoided.
   */
  streetviewFill: SUCCESS,
  streetviewStroke: '#ffffff',

  /** Imported file layers' default tint: Peat Brown, never red (avoidance) or blue (selection). */
  fileVector: PEAT,

  /**
   * Default hex for the user-facing color pickers in the Layer Manager.
   * Kept as a literal because <input type="color"> requires a concrete hex.
   */
  pickerDefault: PEAT,
};

export type MapColors = typeof mapColors;

// Shape of the mapColors object (mutable: applyTheme overrides values in place,
// which is safe because the Map only mounts after config — and thus the theme —
// has been applied; see App's config-load flow).
interface MapColorsShape {
  routePrimary: string;
  routeConnector: string;
  routeAlternative: string;
  selectedStroke: string;
  selectedFill: string;
  selectedPoint: string;
  hoverStroke: string;
  hoverFill: string;
  hoverPoint: string;
  featureStroke: string;
  featureFill: string;
  featurePoint: string;
  areaExtentStroke: string;
  routeHighlight: string;
  pointHalo: string;
  markerFrom: string;
  markerTo: string;
  markerWaypoint: string;
  avoidFill: string;
  avoidStroke: string;
  avoidVertexStroke: string;
  measureStroke: string;
  measureFill: string;
  measureVertexFill: string;
  measureVertexStroke: string;
  streetviewFill: string;
  streetviewStroke: string;
  fileVector: string;
  pickerDefault: string;
}

/**
 * Optional theme overrides supplied via `config.theme` (see map.config.ts).
 * Every key is an optional hex string; absent keys keep the defaults above.
 */
export interface ThemeColors {
  /** Brand/accent color. Drives the UI ramps (see lib/theme.ts) and, as a
   *  fallback, the accent map geometry below when its granular keys are unset. */
  primary?: string;
  /** Optional single-hex UI knobs consumed by lib/theme.ts (not map geometry). */
  neutral?: string;
  surface?: string;
  background?: string;
  text?: string;
  border?: string;
  success?: string;
  danger?: string;
  warning?: string;
  /** Granular map-geometry overrides (win over the `primary` fallback). */
  routePrimary?: string;
  routeAlternative?: string;
  markerFrom?: string;
  markerTo?: string;
  markerWaypoint?: string;
  avoid?: string;
  featureSelected?: string;
}

/**
 * Darken a hex color by `amount` (0..1) toward black. Used to derive an
 * avoid-area stroke from a single `theme.avoid` fill so the outline reads as a
 * stronger shade of the same hue. Falls back to the input if it can't parse.
 */
function darken(hex: string, amount = 0.35): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.round(((num >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((num >> 8) & 0xff) * (1 - amount));
  const b = Math.round((num & 0xff) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Apply theme overrides from `config.theme` onto the exported `mapColors`.
 * Only string values are honored; unknown/invalid entries are ignored so a
 * malformed config can never break the map. Mutating the shared object in place
 * is intentional (see {@link mapColors}).
 *
 * Key mapping:
 *   primary            → routePrimary + routeConnector + markerFrom + streetviewFill +
 *                        selectedFill/selectedStroke/selectedPoint +
 *                        featureFill/featureStroke/featurePoint + areaExtentStroke +
 *                        routeHighlight (its darker shade)
 *   routePrimary       → routePrimary (+ routeConnector, which shares the color)
 *   routeAlternative   → routeAlternative
 *   markerFrom         → markerFrom
 *   markerTo           → markerTo
 *   markerWaypoint     → markerWaypoint
 *   avoid              → avoidFill + avoidStroke (derived darker shade) +
 *                        avoidVertexStroke (derived darker shade)
 *   featureSelected    → selectedStroke/selectedFill/selectedPoint +
 *                        featureStroke/featureFill/featurePoint + routeHighlight
 */
export function applyTheme(theme: ThemeColors | undefined | null): void {
  if (!theme || typeof theme !== 'object') return;

  const get = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

  const isHex6 = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value);

  // `primary` fallback: a single brand hex fills the accent-bearing map colors
  // (primary route, "from" marker, selected/feature) so one knob themes both the
  // UI and the most prominent map geometry. Runs FIRST so the granular keys below
  // still override it. Semantic colors (markerTo/avoid = red, routeAlternative =
  // grey) are intentionally left on their defaults.
  const primary = get(theme.primary);
  if (primary && isHex6(primary)) {
    const strong = darken(primary, 0.3);
    mapColors.routePrimary = primary;
    mapColors.routeConnector = primary;
    mapColors.markerFrom = primary;
    mapColors.streetviewFill = primary;
    mapColors.selectedFill = primary;
    mapColors.selectedStroke = strong;
    mapColors.selectedPoint = strong;
    mapColors.featureFill = primary;
    mapColors.featureStroke = strong;
    mapColors.featurePoint = strong;
    mapColors.areaExtentStroke = strong;
    // The darker shade, not `primary` itself: the route is drawn in `primary`,
    // and the highlight has to stand apart from it.
    mapColors.routeHighlight = strong;
  }

  const routePrimary = get(theme.routePrimary);
  if (routePrimary) {
    mapColors.routePrimary = routePrimary;
    mapColors.routeConnector = routePrimary;
  }

  const routeAlternative = get(theme.routeAlternative);
  if (routeAlternative) mapColors.routeAlternative = routeAlternative;

  const markerFrom = get(theme.markerFrom);
  if (markerFrom) mapColors.markerFrom = markerFrom;

  const markerTo = get(theme.markerTo);
  if (markerTo) mapColors.markerTo = markerTo;

  const markerWaypoint = get(theme.markerWaypoint);
  if (markerWaypoint) mapColors.markerWaypoint = markerWaypoint;

  const avoid = get(theme.avoid);
  if (avoid) {
    mapColors.avoidFill = avoid;
    mapColors.avoidStroke = avoid;
    mapColors.avoidVertexStroke = darken(avoid);
  }

  const featureSelected = get(theme.featureSelected);
  if (featureSelected) {
    const strong = darken(featureSelected, 0.3);
    mapColors.selectedFill = featureSelected;
    mapColors.selectedStroke = strong;
    mapColors.selectedPoint = strong;
    mapColors.featureFill = featureSelected;
    mapColors.featureStroke = strong;
    mapColors.featurePoint = strong;
    mapColors.areaExtentStroke = strong;
    mapColors.routeHighlight = featureSelected;
  }
}
