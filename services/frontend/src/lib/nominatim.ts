import { loadMapConfig } from '../config/map.config';
import { serviceFailureMessage } from './errors';
import { fetchWithTimeout } from './fetchWithTimeout';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeoJSONFeature = Feature<Geometry, Record<string, any>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeoJSONFeatureCollection = FeatureCollection<Geometry, Record<string, any>>;

/** The visible map area in degrees, as `MapHandle.getBounds()` reports it. */
export interface ViewBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface GeocodeOptions {
  /**
   * Current map view. Nominatim ranks hits inside it first ("Storgata" finds
   * the one on screen) without excluding hits elsewhere.
   */
  viewbox?: ViewBounds | null;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;

/**
 * Nominatim's `viewbox` parameter (`west,south,east,north`) for a view, or
 * null when the view is unusable. Longitudes are clamped to ±180 because a
 * zoomed-out Leaflet map reports wrapped bounds beyond that, which the backend
 * rejects as malformed.
 */
export function formatViewbox(bounds: ViewBounds | null | undefined): string | null {
  if (!bounds) return null;
  const values = [bounds.west, bounds.south, bounds.east, bounds.north];
  if (!values.every((value) => Number.isFinite(value))) return null;
  const west = round5(clamp(bounds.west, -180, 180));
  const east = round5(clamp(bounds.east, -180, 180));
  const south = round5(clamp(bounds.south, -90, 90));
  const north = round5(clamp(bounds.north, -90, 90));
  if (west > east || south > north) return null;
  return `${west},${south},${east},${north}`;
}

export async function Geocode(
  query: string,
  options: GeocodeOptions = {}
): Promise<GeoJSONFeature[]> {
    if (!query.trim()) return [];

    // Load config to get the API endpoint
    const config = await loadMapConfig();
    let url = `${config.apiEndpoints.nominatim.search}?q=${encodeURIComponent(query)}`;
    const viewbox = formatViewbox(options.viewbox);
    if (viewbox) {
        url += `&viewbox=${viewbox}`;
    }
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });

    if (!res.ok) {
        // Our own sentence for the status: the backend's detail names internal
        // services and carries codes, which mean nothing to the people here.
        console.warn(`[nominatim] search failed with status ${res.status}`);
        throw new Error(serviceFailureMessage('Søket kunne ikke utføres', 'søketjenesten', res.status));
    }

    const geojson: GeoJSONFeatureCollection = await res.json();

    if (!geojson.features || !Array.isArray(geojson.features)) {
        throw new Error('Ugyldig GeoJSON-svar');
    }

    return geojson.features;
}

export async function ReverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<GeoJSONFeature | null> {
    // Load config to get the API endpoint
    const config = await loadMapConfig();
    const url = `${config.apiEndpoints.nominatim.reverse}?lat=${lat}&lon=${lon}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal });

    if (!res.ok) {
        console.warn(`[nominatim] reverse geocoding failed with status ${res.status}`);
        throw new Error(
            serviceFailureMessage('Kunne ikke hente adressen for punktet', 'adressetjenesten', res.status)
        );
    }

    const geojson: GeoJSONFeatureCollection = await res.json();

    if (geojson.type !== 'FeatureCollection' || !geojson.features || geojson.features.length === 0) {
        return null;
    }

    return geojson.features[0];
}

