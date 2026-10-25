/**
 * Helpers for presenting Overpass result features in the results list and the
 * details card. Overpass features carry raw OSM tags in `feature.properties`;
 * these helpers pull out the human-relevant ones and reshape a hit into the
 * place shape the card reads.
 */
import { translatePlaceType } from './placeTypes';
import type { GeoJSONFeature } from './nominatim';
import { asString } from './stringUtils';

type Props = Record<string, unknown>;

/** Norwegian labels for the primary OSM category keys. */
const CATEGORY_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'historic', 'craft'] as const;

/**
 * The primary category value for a feature, e.g. the `amenity`/`shop`/… tag
 * value (with underscores turned into spaces). Returns undefined if none match.
 */
export function getCategory(props: Props | null | undefined): string | undefined {
  if (!props) return undefined;
  for (const key of CATEGORY_KEYS) {
    // Only a Norwegian name counts; an unknown tag value is not shown in English.
    const value = asString(props[key]);
    const label = value ? translatePlaceType(value) : undefined;
    if (label) return label;
  }
  return undefined;
}

/** Display name: `name`, else the category, else a Norwegian "no name" label. */
export function getDisplayName(feature: GeoJSONFeature): string {
  const props = (feature.properties ?? {}) as Props;
  return asString(props.name) ?? getCategory(props) ?? 'Ingen navn';
}

/** Single-line address from addr:* tags (street + house number, then city). */
export function getAddress(props: Props | null | undefined): string | undefined {
  if (!props) return undefined;
  const street = asString(props['addr:street']);
  const houseNumber = asString(props['addr:housenumber']);
  const city = asString(props['addr:city']);

  const line1 = [street, houseNumber].filter(Boolean).join(' ');
  const parts = [line1, city].filter((part) => part && part.length > 0);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * A short subtitle for a sidebar row: the category and/or address, whichever
 * are present. Returns undefined when there's nothing useful to show.
 */
export function getSubtitle(feature: GeoJSONFeature): string | undefined {
  const props = (feature.properties ?? {}) as Props;
  const category = getCategory(props);
  const address = getAddress(props);
  // An unnamed feature is shown by its category, so the subtitle must not
  // say it again (and a name equal to the category needs no echo either).
  const name = asString(props.name);
  const parts: string[] = [];
  if (category && name && category !== name) parts.push(category);
  if (address) parts.push(address);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Every coordinate pair in a geometry, however deeply nested. */
function walkCoordinates(coords: unknown, visit: (lng: number, lat: number) => void): void {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    visit(coords[0], coords[1]);
    return;
  }
  coords.forEach((child) => walkCoordinates(child, visit));
}

/** OSM `addr:*` tags and the Nominatim address fields the card reads. */
const ADDRESS_FIELDS: Record<string, string> = {
  'addr:street': 'road',
  'addr:housenumber': 'house_number',
  'addr:postcode': 'postcode',
  'addr:city': 'city'
};

/**
 * An area-search hit in the shape the details card reads, which is
 * Nominatim's: the name as `display_name`, the category tag as
 * `category`/`type`, `addr:*` as a structured `address`, and every other tag as
 * `extratags`. The card, saving and routing then treat a hit exactly like a
 * searched place. An area gets a bounding box, so it has a point to save and
 * route to; `__overpassIndex` ties the card back to its row and its dot.
 */
export function toPlaceFeature(feature: GeoJSONFeature, index: number): GeoJSONFeature {
  const props = (feature.properties ?? {}) as Props;
  const categoryKey = CATEGORY_KEYS.find((key) => asString(props[key]));
  const address: Props = {};
  const extratags: Props = {};
  for (const [key, value] of Object.entries(props)) {
    if (key in ADDRESS_FIELDS) {
      const text = asString(value);
      if (text) address[ADDRESS_FIELDS[key]] = text;
    } else if (key !== 'name' && key !== categoryKey && key !== '__overpassIndex' && !key.startsWith('addr:')) {
      extratags[key] = value;
    }
  }

  let bbox: [number, number, number, number] | undefined;
  const geometry = feature.geometry;
  if (geometry && geometry.type !== 'Point' && 'coordinates' in geometry) {
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    walkCoordinates(geometry.coordinates, (lng, lat) => {
      box[0] = Math.min(box[0], lng);
      box[1] = Math.min(box[1], lat);
      box[2] = Math.max(box[2], lng);
      box[3] = Math.max(box[3], lat);
    });
    if (Number.isFinite(box[0])) bbox = box;
  }

  const name = asString(props.name);
  return {
    type: 'Feature',
    geometry,
    ...(bbox ? { bbox } : {}),
    properties: {
      // The long form, as Nominatim gives it: the name, then the address.
      display_name: [getDisplayName(feature), getAddress(props)].filter(Boolean).join(', '),
      ...(name ? { name } : {}),
      ...(categoryKey ? { category: categoryKey, type: asString(props[categoryKey]) } : {}),
      address,
      extratags,
      __overpassIndex: index
    }
  };
}
