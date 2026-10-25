/**
 * Route details derived from GraphHopper's elevation and path details: all
 * measured in metres along the route, never in point indices, because points
 * are unevenly spaced. Pure: no Leaflet, no React.
 */
import type { DetailValue, RouteResult } from './graphhopper';
import { detailLabel, OTHER_LABEL, UNKNOWN_LABEL, type CrossingKind, type ShareKey } from './routeDetailLabels';

export interface ProfilePoint {
  /** Metres along the route. */
  at: number;
  height: number;
}

export interface ElevationProfileData {
  points: ProfilePoint[];
  min: number;
  max: number;
  ascend: number;
  descend: number;
  /** Route length (m) along its coordinates. */
  length: number;
}

export interface DetailShare {
  /** Stable within one detail: the label, since categories are grouped by it. */
  id: string;
  label: string;
  metres: number;
  /** Whole percent; the shares of one detail sum to exactly 100. */
  share: number;
  /** The raw values this category stands for (several for "Annet", "Hovedvei"). */
  values: DetailValue[];
}

export type Crossings = Record<CrossingKind, number>;

export interface HighlightTarget {
  key: ShareKey;
  id: string;
}

/** What the route panel points at on the map. */
export interface RouteHighlight {
  /** Metres along the route the profile points at. */
  position: number | null;
  /** A category hovered or focused, shown over the pinned one while it lasts. */
  preview: HighlightTarget | null;
  /** A category pressed: stays lit until pressed again, another is pinned, or Escape. */
  pinned: HighlightTarget | null;
}

/** Plain geometry for the map: [lng, lat]. */
export interface RouteHighlightGeometry {
  point: [number, number] | null;
  stretches: [number, number][][];
}

export const EMPTY_HIGHLIGHT: RouteHighlight = { position: null, preview: null, pinned: null };

/** Under this share (%), a category folds into "Annet". */
const FOLD_BELOW = 2;
const EARTH_RADIUS = 6371008.8;

function haversine(a: number[], b: number[]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

const distanceCache = new WeakMap<RouteResult, number[]>();

export function routeDistances(route: RouteResult): number[] {
  const cached = distanceCache.get(route);
  if (cached) return cached;
  const coords = route.geometry.coordinates;
  const out = coords.length > 0 ? [0] : [];
  for (let i = 1; i < coords.length; i += 1) out.push(out[i - 1] + haversine(coords[i - 1], coords[i]));
  distanceCache.set(route, out);
  return out;
}

export function elevationProfile(route: RouteResult): ElevationProfileData | null {
  const heights = route.elevation;
  if (!heights || heights.length < 2 || heights.length !== route.geometry.coordinates.length) return null;
  const distances = routeDistances(route);
  let min = Infinity;
  let max = -Infinity;
  let up = 0;
  let down = 0;
  heights.forEach((h, i) => {
    min = Math.min(min, h);
    max = Math.max(max, h);
    if (i > 0) {
      const step = h - heights[i - 1];
      if (step > 0) up += step;
      else down -= step;
    }
  });
  return {
    points: heights.map((height, i) => ({ at: distances[i], height })),
    min,
    max,
    ascend: route.ascend ?? up,
    descend: route.descend ?? down,
    length: distances[distances.length - 1]
  };
}

export function heightAt(profile: ElevationProfileData, metres: number): number {
  const pts = profile.points;
  const at = Math.max(0, Math.min(metres, profile.length));
  let i = 1;
  while (i < pts.length - 1 && pts[i].at < at) i += 1;
  const a = pts[i - 1];
  const b = pts[i];
  const span = b.at - a.at;
  const t = span > 0 ? (at - a.at) / span : 0;
  return a.height + (b.height - a.height) * t;
}

export function detailShares(route: RouteResult, key: ShareKey): DetailShare[] {
  const intervals = route.details?.[key];
  if (!intervals || intervals.length === 0) return [];
  const distances = routeDistances(route);
  const total = distances[distances.length - 1];
  if (!(total > 0)) return [];

  const byLabel = new Map<string, { metres: number; values: DetailValue[] }>();
  for (const [from, to, value] of intervals) {
    const metres = distances[to] - distances[from];
    if (!(metres > 0)) continue;
    const label = detailLabel(key, value);
    const group = byLabel.get(label) ?? { metres: 0, values: [] };
    group.metres += metres;
    if (!group.values.includes(value)) group.values.push(value);
    byLabel.set(label, group);
  }

  // Small categories fold into "Annet"; missing data ("Ukjent") never folds,
  // because not knowing is its own answer.
  const folded = new Map<string, { metres: number; values: DetailValue[] }>();
  for (const [label, group] of byLabel) {
    const small = (group.metres / total) * 100 < FOLD_BELOW && label !== UNKNOWN_LABEL;
    const target = small ? OTHER_LABEL : label;
    const into = folded.get(target) ?? { metres: 0, values: [] };
    into.metres += group.metres;
    for (const v of group.values) if (!into.values.includes(v)) into.values.push(v);
    folded.set(target, into);
  }

  const entries = [...folded].map(([label, g]) => ({ id: label, label, metres: g.metres, values: g.values }));
  entries.sort((a, b) => b.metres - a.metres);

  // Largest remainder, so the whole percents always sum to exactly 100.
  const covered = entries.reduce((sum, e) => sum + e.metres, 0);
  const exact = entries.map((e) => (e.metres / covered) * 100);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((sum, n) => sum + n, 0);
  const byRemainder = exact.map((x, i) => ({ i, r: x - shares[i] })).sort((a, b) => b.r - a.r);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return entries.map((e, i) => ({ ...e, share: shares[i] }));
}

export function detailStretches(route: RouteResult, key: ShareKey, id: string): [number, number][][] {
  const intervals = route.details?.[key];
  const share = detailShares(route, key).find((s) => s.id === id);
  if (!intervals || !share) return [];
  const coords = route.geometry.coordinates;
  const runs: [number, number][][] = [];
  let current: [number, number][] | null = null;
  let lastTo = -1;
  for (const [from, to, value] of intervals) {
    if (!share.values.includes(value)) {
      current = null;
      continue;
    }
    const slice = coords.slice(from, to + 1).map((c) => [c[0], c[1]] as [number, number]);
    if (current && from === lastTo) current.push(...slice.slice(1));
    else {
      current = slice;
      runs.push(current);
    }
    lastTo = to;
  }
  return runs.filter((run) => run.length >= 2);
}

export function crossings(route: RouteResult): Crossings | null {
  const intervals = route.details?.road_environment;
  if (!intervals) return null;
  const out: Crossings = { ferry: 0, tunnel: 0, bridge: 0 };
  let previous: DetailValue = null;
  let lastTo = -1;
  for (const [from, to, value] of intervals) {
    const continues = value === previous && from === lastTo;
    if ((value === 'ferry' || value === 'tunnel' || value === 'bridge') && !continues) out[value] += 1;
    previous = value;
    lastTo = to;
  }
  return out;
}

export function positionAt(
  route: RouteResult,
  metres: number
): { lngLat: [number, number]; height: number | null } | null {
  const coords = route.geometry.coordinates;
  if (coords.length === 0) return null;
  const heights = route.elevation && route.elevation.length === coords.length ? route.elevation : null;
  if (coords.length === 1) return { lngLat: [coords[0][0], coords[0][1]], height: heights?.[0] ?? null };
  const d = routeDistances(route);
  const target = Math.max(0, Math.min(metres, d[d.length - 1]));
  let i = 1;
  while (i < d.length - 1 && d[i] < target) i += 1;
  const span = d[i] - d[i - 1];
  const t = span > 0 ? (target - d[i - 1]) / span : 0;
  const a = coords[i - 1];
  const b = coords[i];
  return {
    lngLat: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    height: heights ? heights[i - 1] + (heights[i] - heights[i - 1]) * t : null
  };
}

/**
 * At most ~2 points per bucket (its lowest and highest) plus the ends, so a
 * long route draws cheaply without shaving off its peaks and dips. For the
 * chart only; map highlights use the full geometry.
 */
export function downsampleProfile(points: ProfilePoint[], buckets: number): ProfilePoint[] {
  if (buckets < 1 || points.length <= buckets * 2) return points;
  const length = points[points.length - 1].at || 1;
  const low = new Map<number, ProfilePoint>();
  const high = new Map<number, ProfilePoint>();
  for (const p of points) {
    const b = Math.min(buckets - 1, Math.floor((p.at / length) * buckets));
    const lo = low.get(b);
    const hi = high.get(b);
    if (!lo || p.height < lo.height) low.set(b, p);
    if (!hi || p.height > hi.height) high.set(b, p);
  }
  const picked = new Set<ProfilePoint>([points[0], points[points.length - 1], ...low.values(), ...high.values()]);
  return [...picked].sort((a, b) => a.at - b.at);
}

export function highlightGeometry(route: RouteResult, highlight: RouteHighlight): RouteHighlightGeometry | null {
  const point = highlight.position === null ? null : (positionAt(route, highlight.position)?.lngLat ?? null);
  const shown = highlight.preview ?? highlight.pinned;
  const stretches = shown ? detailStretches(route, shown.key, shown.id) : [];
  if (!point && stretches.length === 0) return null;
  return { point, stretches };
}
