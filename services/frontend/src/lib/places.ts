/**
 * Recent searches and saved places ("Mine steder"), kept per browser in
 * localStorage. Everything here is pure: storage access is injected so the
 * module is unit-testable, and nothing throws on a broken, full or missing
 * store. Entries are validated on read, mirroring `customLayers.ts`, so a bad
 * entry can never crash the app on load.
 */
import type { GeoJSONFeature } from './nominatim';
import { asString } from './stringUtils';
import { readBbox } from './featureView';

export interface StoredPlace {
  /** OSM identity (`relation:406091`) when known, else `name@lat,lng`. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Nominatim `type` (e.g. "city", "station"); shown as the row subtitle. */
  category?: string;
  /** `[west, south, east, north]` of the original result, so a city fits the screen again. */
  bbox?: [number, number, number, number];
  /** Epoch milliseconds when the entry was (last) added. */
  savedAt: number;
}

export const RECENT_PLACES_KEY = 'openmaps.recentSearches';
export const SAVED_PLACES_KEY = 'openmaps.savedPlaces';
export const MAX_RECENT_PLACES = 8;
export const MAX_SAVED_PLACES = 50;

type Props = Record<string, unknown>;

const isRecord = (value: unknown): value is Props =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
const isLng = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

/** The point a feature stands for: its Point geometry, else its bbox centre. */
function pointOf(feature: GeoJSONFeature): { lat: number; lng: number } | null {
  const geometry = feature.geometry;
  if (geometry && geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lng, lat] = geometry.coordinates;
    if (isLat(lat) && isLng(lng)) return { lat, lng };
  }
  const bbox = readBbox(feature);
  if (bbox) {
    const lng = (bbox[0] + bbox[2]) / 2;
    const lat = (bbox[1] + bbox[3]) / 2;
    if (isLat(lat) && isLng(lng)) return { lat, lng };
  }
  return null;
}

/** A search result reduced to what the lists need; null when it has no name or location. */
export function toStoredPlace(feature: GeoJSONFeature, now: number = Date.now()): StoredPlace | null {
  const props = (feature.properties ?? {}) as Props;
  const name = asString(props.display_name) ?? asString(props.name);
  const point = pointOf(feature);
  if (!name || !point) return null;

  const osmType = asString(props.osm_type);
  const osmId = props.osm_id;
  const hasOsmId = typeof osmId === 'number' || (typeof osmId === 'string' && osmId !== '');
  const id =
    asString(props.stored_place_id) ??
    (osmType && hasOsmId
      ? `${osmType}:${osmId}`
      : `${name}@${point.lat.toFixed(5)},${point.lng.toFixed(5)}`);

  const place: StoredPlace = { id, name, lat: point.lat, lng: point.lng, savedAt: now };
  const category = asString(props.type);
  if (category) place.category = category;
  const bbox = readBbox(feature);
  if (bbox) place.bbox = bbox;
  return place;
}

/**
 * Rebuild a feature the map and sidebar understand. The bbox travels along so
 * `resolveFeatureView` fits an area instead of zooming to its centre, and
 * `stored_place_id` keeps the identity stable through another `toStoredPlace`.
 */
export function toFeature(place: StoredPlace): GeoJSONFeature {
  return {
    type: 'Feature',
    ...(place.bbox ? { bbox: place.bbox } : {}),
    geometry: { type: 'Point', coordinates: [place.lng, place.lat] },
    properties: {
      display_name: place.name,
      name: place.name,
      ...(place.category ? { type: place.category } : {}),
      stored_place_id: place.id
    }
  };
}

/** Keep only well-formed, unique entries. Anything that is not an array yields []. */
export function sanitizeStoredPlaces(raw: unknown): StoredPlace[] {
  if (!Array.isArray(raw)) return [];
  const result: StoredPlace[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { id, name, lat, lng, savedAt, category, bbox } = entry;
    if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name === '') continue;
    if (!isLat(lat) || !isLng(lng)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const place: StoredPlace = {
      id,
      name,
      lat,
      lng,
      savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0
    };
    if (typeof category === 'string' && category !== '') place.category = category;
    if (
      Array.isArray(bbox) &&
      bbox.length === 4 &&
      bbox.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      place.bbox = [bbox[0], bbox[1], bbox[2], bbox[3]];
    }
    result.push(place);
  }
  return result;
}

/** Read and sanitise a list; never throws. */
export function loadPlaces(storage: Pick<Storage, 'getItem'> | undefined, key: string): StoredPlace[] {
  if (!storage) return [];
  try {
    const saved = storage.getItem(key);
    if (!saved) return [];
    return sanitizeStoredPlaces(JSON.parse(saved));
  } catch {
    return [];
  }
}

/** Write a list; returns false when the store refused (quota, private mode). */
export function savePlaces(
  storage: Pick<Storage, 'setItem'> | undefined,
  key: string,
  places: StoredPlace[]
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(places));
    return true;
  } catch {
    return false;
  }
}

/** Newest first, one entry per place, at most `max` entries. */
export function pushRecent(list: StoredPlace[], place: StoredPlace, max: number = MAX_RECENT_PLACES): StoredPlace[] {
  return [place, ...list.filter((entry) => entry.id !== place.id)].slice(0, max);
}

export function isSaved(list: StoredPlace[], id: string): boolean {
  return list.some((entry) => entry.id === id);
}

/** Newest first. Returns the same list when already saved, null when full. */
export function addSaved(list: StoredPlace[], place: StoredPlace, max: number = MAX_SAVED_PLACES): StoredPlace[] | null {
  if (isSaved(list, place.id)) return list;
  if (list.length >= max) return null;
  return [place, ...list];
}

export function removeSaved(list: StoredPlace[], id: string): StoredPlace[] {
  return list.filter((entry) => entry.id !== id);
}
