// Shareable map-state encoded in the URL hash.
//
// Follows the OpenStreetMap convention `#map=ZOOM/LAT/LNG`, extended with
// extra `&key=value` segments:
//   #map=14/59.9139/10.7522&style=osm&route=59.91,10.75;59.95,10.80&streetview=1
//
// Using the hash (not the query string) keeps everything client-side: changing
// the map state never makes a server round-trip.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapView {
  zoom: number;
  lat: number;
  lng: number;
}

export interface MapHashState {
  /** Map view (zoom + center). Optional so a hash can carry only style/route. */
  view?: MapView;
  /** Active base-map style id (see mapStyles.ts). */
  style?: string;
  /** Ordered route waypoints (from, ...via, to) when a route is active. */
  route?: LatLng[];
  /** True when the "Gatebilde" point layer is switched on (off by default). */
  streetview?: boolean;
}

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;
const ZOOM_MIN = 0;
const ZOOM_MAX = 22;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// Round to ~5 decimals (~1 m precision) to keep hashes short and stable.
const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;

const parseFiniteFloat = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/**
 * Parse a `#map=...` style hash into a partial {@link MapHashState}.
 *
 * Robust by design: malformed segments are skipped rather than thrown, unknown
 * keys are ignored, and out-of-range values are clamped. Returns `null` only
 * when nothing usable could be extracted.
 */
export function parseMapHash(hash: string): MapHashState | null {
  if (typeof hash !== 'string') return null;

  // Tolerate a leading '#', and an optional leading '/' (some routers prepend).
  let body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body.startsWith('/')) body = body.slice(1);
  if (body.trim() === '') return null;

  const state: MapHashState = {};

  for (const segment of body.split('&')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq);
    let value: string;
    try {
      value = decodeURIComponent(segment.slice(eq + 1));
    } catch {
      // Malformed percent-encoding (e.g. a bare '%'): skip just this segment.
      continue;
    }

    if (key === 'map') {
      const view = parseView(value);
      if (view) state.view = view;
    } else if (key === 'style') {
      if (value.trim() !== '') state.style = value;
    } else if (key === 'route') {
      const route = parseRoute(value);
      if (route.length > 0) state.route = route;
    } else if (key === 'streetview') {
      const flag = value.trim().toLowerCase();
      if (flag === '1' || flag === 'true' || flag === 'on') state.streetview = true;
    }
    // Unknown keys are ignored.
  }

  return Object.keys(state).length > 0 ? state : null;
}

function parseView(value: string): MapView | null {
  // Expected `ZOOM/LAT/LNG`.
  const parts = value.split('/');
  if (parts.length !== 3) return null;

  const zoomRaw = parseFiniteFloat(parts[0]);
  const lat = parseFiniteFloat(parts[1]);
  const lng = parseFiniteFloat(parts[2]);
  if (zoomRaw === null || lat === null || lng === null) return null;

  return {
    zoom: clamp(Math.round(zoomRaw), ZOOM_MIN, ZOOM_MAX),
    lat: clamp(lat, LAT_MIN, LAT_MAX),
    lng: clamp(lng, LNG_MIN, LNG_MAX)
  };
}

function parseRoute(value: string): LatLng[] {
  const points: LatLng[] = [];
  for (const pair of value.split(';')) {
    if (pair.trim() === '') continue;
    const coords = pair.split(',');
    if (coords.length !== 2) continue;
    const lat = parseFiniteFloat(coords[0]);
    const lng = parseFiniteFloat(coords[1]);
    if (lat === null || lng === null) continue;
    points.push({
      lat: clamp(lat, LAT_MIN, LAT_MAX),
      lng: clamp(lng, LNG_MIN, LNG_MAX)
    });
  }
  return points;
}

/**
 * Serialize a {@link MapHashState} back into a `#map=...` hash string
 * (including the leading `#`). Invalid/empty parts are omitted.
 */
export function serializeMapHash(state: MapHashState): string {
  const segments: string[] = [];

  if (
    state.view &&
    isFiniteNumber(state.view.zoom) &&
    isFiniteNumber(state.view.lat) &&
    isFiniteNumber(state.view.lng)
  ) {
    const zoom = clamp(Math.round(state.view.zoom), ZOOM_MIN, ZOOM_MAX);
    const lat = round5(clamp(state.view.lat, LAT_MIN, LAT_MAX));
    const lng = round5(clamp(state.view.lng, LNG_MIN, LNG_MAX));
    segments.push(`map=${zoom}/${lat}/${lng}`);
  }

  if (state.style && state.style.trim() !== '') {
    segments.push(`style=${encodeURIComponent(state.style)}`);
  }

  if (state.route && state.route.length > 0) {
    const pairs = state.route
      .filter((p) => isFiniteNumber(p.lat) && isFiniteNumber(p.lng))
      .map((p) => {
        const lat = round5(clamp(p.lat, LAT_MIN, LAT_MAX));
        const lng = round5(clamp(p.lng, LNG_MIN, LNG_MAX));
        return `${lat},${lng}`;
      });
    if (pairs.length > 0) {
      segments.push(`route=${pairs.join(';')}`);
    }
  }

  if (state.streetview === true) {
    segments.push('streetview=1');
  }

  return segments.length > 0 ? `#${segments.join('&')}` : '';
}
