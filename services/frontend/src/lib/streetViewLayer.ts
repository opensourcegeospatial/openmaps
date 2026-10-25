/**
 * Decides whether the street-view point layer should fetch points for the
 * current view. Kept pure so the gating (zoom + coverage bounds) is testable
 * without Leaflet.
 */
import type { StreetViewConfig } from '../config/map.config';

/** Below this zoom a country-sized view would mean tens of thousands of markers. */
export const STREETVIEW_DEFAULT_MIN_ZOOM = 14;

export interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const intersects = (a: ViewBounds, b: [number, number, number, number]): boolean => {
  const [west, south, east, north] = b;
  return a.west <= east && a.east >= west && a.south <= north && a.north >= south;
};

/**
 * Why the layer can or cannot show points for this view: fine, too far out,
 * too close, or outside the area that has panoramas. The UI turns anything
 * but 'ok' into a line under the Gatebilde row.
 */
export type StreetViewCoverage = 'ok' | 'zoom-in' | 'zoom-out' | 'outside';

export function streetViewCoverage(
  zoom: number,
  view: ViewBounds,
  config: Pick<StreetViewConfig, 'minZoom' | 'maxZoom' | 'bounds'>
): StreetViewCoverage {
  const minZoom = config.minZoom ?? STREETVIEW_DEFAULT_MIN_ZOOM;
  if (zoom < minZoom) return 'zoom-in';
  if (typeof config.maxZoom === 'number' && zoom > config.maxZoom) return 'zoom-out';
  if (config.bounds && config.bounds.length === 4 && !intersects(view, config.bounds)) return 'outside';
  return 'ok';
}

export function shouldLoadStreetViewPoints(
  zoom: number,
  view: ViewBounds,
  config: Pick<StreetViewConfig, 'minZoom' | 'maxZoom' | 'bounds'>
): boolean {
  return streetViewCoverage(zoom, view, config) === 'ok';
}

/** The fields that decide whether street view can work in this deployment. */
export interface StreetViewSource {
  enabled?: boolean;
  tilesUrl?: string;
  geoJsonUrl?: string;
  panoramaUrl?: string;
}

/**
 * Whether this deployment has street view at all: it has to be enabled, have
 * somewhere to read points from, and somewhere to fetch a panorama.
 *
 * One definition, shared by the layer toggle, the "Gatebilde" tool row and the
 * search card's teaching line, so none of them can offer what the others
 * refuse (polish round 8).
 */
export function isStreetViewConfigured(config?: StreetViewSource | null): boolean {
  return Boolean(config?.enabled && (config.tilesUrl || config.geoJsonUrl) && config.panoramaUrl);
}
