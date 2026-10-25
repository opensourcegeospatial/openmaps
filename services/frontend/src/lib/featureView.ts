/**
 * Where the map should go when a feature is selected.
 *
 * Nominatim gives every result a bbox. For a shop node it is a few metres
 * around the point; for a city returned as a node it is the city's rank-based
 * extent. Zooming to street level on the centre of a city is wrong, so a point
 * whose bbox is wider than a couple of hundred metres is treated as an area.
 * Stored places (Mine steder, recent searches) are rebuilt as points with
 * their original bbox and rely on the same rule.
 */
import type { GeoJSONFeature } from './nominatim';

/** A bbox narrower than this in both axes (degrees, ~200 m) counts as a point. */
export const POINT_EXTENT_DEGREES = 0.002;
export const POINT_ZOOM = 18;

export type FeatureView =
  | { kind: 'point'; lat: number; lng: number; zoom: number }
  /** Leaflet order: [[south, west], [north, east]]. */
  | { kind: 'bounds'; bounds: [[number, number], [number, number]] };

/** The feature's `[west, south, east, north]` bbox, or null when unusable. */
export function readBbox(feature: GeoJSONFeature): [number, number, number, number] | null {
  const bbox = feature.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every((value) => Number.isFinite(value))) return null;
  return [west, south, east, north];
}

export function resolveFeatureView(feature: GeoJSONFeature): FeatureView | null {
  const bbox = readBbox(feature);
  const isArea =
    bbox !== null &&
    (bbox[2] - bbox[0] >= POINT_EXTENT_DEGREES || bbox[3] - bbox[1] >= POINT_EXTENT_DEGREES);

  if (feature.geometry?.type === 'Point' && !isArea) {
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { kind: 'point', lat, lng, zoom: POINT_ZOOM };
  }
  if (bbox) {
    return {
      kind: 'bounds',
      bounds: [
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]]
      ]
    };
  }
  return null;
}
