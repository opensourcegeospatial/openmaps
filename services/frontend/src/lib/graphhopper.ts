import type { FeatureCollection, Geometry, LineString, Feature } from 'geojson';
import { loadMapConfig } from '../config/map.config';
import { fetchWithTimeout } from './fetchWithTimeout';
import { keyFailureMessage, routeFailureMessage } from './routingStatus';

/** A single avoid-area: a ring of [lng, lat] pairs (need not be closed). */
export type AvoidArea = [number, number][];

interface RouteOptions {
  profile?: 'car' | 'foot' | 'bike';
  /** Request alternative routes (switches the backend to flexible mode). */
  alternatives?: boolean;
  /** Polygons (rings of [lng,lat]) the route must avoid. */
  avoidAreas?: AvoidArea[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RouteProperties = Record<string, any>;

/**
 * A routing request that failed for a reason other than "no route between the
 * points". `message` is Norwegian and safe to show; `status` is the HTTP status
 * the backend answered with.
 */
export class RouteError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RouteError';
    this.status = status;
  }
}

/**
 * The backend's own upstream timeout is 30 s; the flexible (avoid-areas /
 * alternatives, CH disabled) path can legitimately take that long, so the UI
 * must not give up first.
 */
const ROUTE_TIMEOUT_MS = 35_000;

/** The route details the backend passes through from GraphHopper, when it has them. */
export type DetailKey = 'surface' | 'road_class' | 'max_speed' | 'road_environment';
export type DetailValue = string | number | null;
/** [first point index, last point index, value] — GraphHopper's own shape. */
export type DetailInterval = [number, number, DetailValue];
export const DETAIL_KEYS: readonly DetailKey[] = ['surface', 'road_class', 'max_speed', 'road_environment'];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Heights (m), one per geometry coordinate, or nothing: a profile with a gap
 * or of the wrong length would be drawn wrong, so it is not drawn at all.
 */
export function parseElevation(raw: unknown, coordinateCount: number): number[] | undefined {
  if (!Array.isArray(raw) || raw.length !== coordinateCount || raw.length < 2) return undefined;
  return raw.every(isFiniteNumber) ? (raw as number[]) : undefined;
}

/** Known details only, intervals clamped to the coordinates, empty ones dropped. */
export function parseDetails(
  raw: unknown,
  coordinateCount: number
): Partial<Record<DetailKey, DetailInterval[]>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const last = coordinateCount - 1;
  const out: Partial<Record<DetailKey, DetailInterval[]>> = {};
  for (const key of DETAIL_KEYS) {
    const list = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    const intervals: DetailInterval[] = [];
    for (const item of list) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const [a, b, v] = item;
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      const from = Math.max(0, Math.min(a as number, last));
      const to = Math.max(0, Math.min(b as number, last));
      if (to <= from) continue;
      const value: DetailValue = typeof v === 'string' || isFiniteNumber(v) ? v : null;
      intervals.push([from, to, value]);
    }
    if (intervals.length > 0) out[key] = intervals;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** One route returned by the backend (primary first, then alternatives). */
export interface RouteResult {
  geometry: LineString;
  distance: number;
  time: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instructions: any[];
  primary: boolean;
  routeIndex: number;
  /** Height (m) at each geometry coordinate, when GraphHopper has elevation. */
  elevation?: number[];
  /** Total climb and descent (m), when GraphHopper has elevation. */
  ascend?: number;
  descend?: number;
  /** Point-index intervals per detail, for the details GraphHopper stores. */
  details?: Partial<Record<DetailKey, DetailInterval[]>>;
}

/**
 * Backend /route response shape (new): a list of routes plus optional dashed
 * connector segments (original click point -> snapped point) for the primary.
 */
export interface RouteResponse {
  routes: RouteResult[];
  dashedSegments: [number, number][][];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RouteFeatureCollection = FeatureCollection<Geometry, Record<string, any>>;

/**
 * Build a Leaflet-friendly FeatureCollection from a RouteResponse.
 *
 * Each route becomes a LineString Feature whose properties carry distance/time/
 * instructions plus `primary`, `route_index` and a `style` of 'solid'
 * (primary) or 'alternative'. Dashed connector segments are appended as
 * style='dashed' features (matching the previous Map.tsx styling contract).
 */
export function routeResponseToFeatureCollection(
  response: RouteResponse,
  selectedIndex = 0
): RouteFeatureCollection {
  const features: Feature<Geometry, RouteProperties>[] = response.routes.map((route) => ({
    type: 'Feature',
    geometry: route.geometry,
    properties: {
      distance: route.distance,
      time: route.time,
      instructions: route.instructions,
      route_index: route.routeIndex,
      primary: route.routeIndex === selectedIndex,
      // 'solid' for the selected route, 'alternative' for the rest.
      style: route.routeIndex === selectedIndex ? 'solid' : 'alternative'
    }
  }));

  for (const segment of response.dashedSegments) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: segment },
      properties: { style: 'dashed' }
    });
  }

  return { type: 'FeatureCollection', features };
}

/** The machine-readable `code` of a backend error body, if it has one. */
async function readErrorCode(res: Response): Promise<unknown> {
  try {
    return ((await res.json()) as { code?: unknown } | null)?.code;
  } catch {
    return undefined;
  }
}

/**
 * Fetch one or more routes from the backend.
 *
 * Returns a typed RouteResponse (routes[] + dashedSegments[]), or null when
 * fewer than two waypoints are supplied. Tolerant of the legacy
 * FeatureCollection shape so a stale backend doesn't break the UI.
 */
export async function getRoute(
  waypoints: { lat: number; lng: number }[],
  options: RouteOptions = {}
): Promise<RouteResponse | null> {
  if (waypoints.length < 2) return null;

  const { profile = 'car', alternatives = false, avoidAreas = [] } = options;

  const from = `${waypoints[0].lat},${waypoints[0].lng}`;
  const to = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;

  const waypointParams = waypoints
    .slice(1, -1)
    .map((wp) => `waypoint=${encodeURIComponent(`${wp.lat},${wp.lng}`)}`)
    .join('&');

  const config = await loadMapConfig();
  const baseUrl = config.apiEndpoints.graphhopper;

  let url =
    `${baseUrl}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
    (waypointParams ? `&${waypointParams}` : '') +
    `&profile=${profile}`;

  if (alternatives) {
    url += `&alternatives=true`;
  }
  if (avoidAreas.length > 0) {
    // Backend expects a JSON-encoded array of polygons, each a [lng,lat][] ring.
    url += `&avoid_areas=${encodeURIComponent(JSON.stringify(avoidAreas))}`;
  }

  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
    timeoutMs: ROUTE_TIMEOUT_MS
  });

  if (!res.ok) {
    // 400 is how the backend reports a GraphHopper "cannot find a route /
    // point" answer: not a failure of the service, just no route to draw.
    if (res.status === 400) return null;
    // The backend's own detail names internal services and carries status
    // codes, so the user gets our sentence for the status instead. The one
    // exception is a refused API key: the backend marks it with a code, and the
    // user (or whoever runs the service) can act on it.
    if (res.status === 502) {
      const keyMessage = keyFailureMessage(await readErrorCode(res));
      if (keyMessage) throw new RouteError(keyMessage, res.status);
    }
    throw new RouteError(routeFailureMessage(res.status), res.status);
  }

  const payload = await res.json();
  if (import.meta.env.DEV) {
    console.log('Route response:', payload);
  }

  return normalizeRouteResponse(payload);
}

/**
 * Coerce the backend payload into a RouteResponse, accepting both the new
 * `{ routes, dashed_segments }` shape and the legacy FeatureCollection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRouteResponse(payload: any): RouteResponse | null {
  if (!payload) return null;

  // New shape: { routes: [...], dashed_segments: [...] }
  if (Array.isArray(payload.routes)) {
    const routes: RouteResult[] = payload.routes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((feature: any, index: number) => {
        const geometry = feature.geometry as LineString | undefined;
        if (!geometry || geometry.type !== 'LineString') return null;
        const props = feature.properties ?? {};
        const count = Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
        const elevation = parseElevation(props.elevation, count);
        const details = parseDetails(props.details, count);
        return {
          geometry,
          distance: Number(props.distance ?? 0),
          time: Number(props.time ?? 0),
          instructions: Array.isArray(props.instructions) ? props.instructions : [],
          primary: props.primary === true || index === 0,
          routeIndex: typeof props.route_index === 'number' ? props.route_index : index,
          ...(elevation ? { elevation } : {}),
          ...(isFiniteNumber(props.ascend) ? { ascend: props.ascend } : {}),
          ...(isFiniteNumber(props.descend) ? { descend: props.descend } : {}),
          ...(details ? { details } : {})
        } as RouteResult;
      })
      .filter((r: RouteResult | null): r is RouteResult => r !== null);

    if (routes.length === 0) return null;

    const dashedSegments: [number, number][][] = Array.isArray(payload.dashed_segments)
      ? payload.dashed_segments
      : [];

    return { routes, dashedSegments };
  }

  // Legacy shape: a FeatureCollection of solid/dashed features.
  if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    const routes: RouteResult[] = [];
    const dashedSegments: [number, number][][] = [];
    let routeIndex = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload.features.forEach((feature: any) => {
      const geometry = feature.geometry as LineString | undefined;
      if (!geometry || geometry.type !== 'LineString') return;
      const props = feature.properties ?? {};
      if (props.style === 'dashed') {
        dashedSegments.push(geometry.coordinates as [number, number][]);
        return;
      }
      routes.push({
        geometry,
        distance: Number(props.distance ?? 0),
        time: Number(props.time ?? 0),
        instructions: Array.isArray(props.instructions) ? props.instructions : [],
        primary: routeIndex === 0,
        routeIndex
      });
      routeIndex += 1;
    });
    if (routes.length === 0) return null;
    return { routes, dashedSegments };
  }

  return null;
}
