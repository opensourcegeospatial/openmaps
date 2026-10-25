/**
 * Curated, display-ready presentation of a Nominatim reverse-geocode feature
 * for the "Detaljer" sidebar.
 *
 * Nominatim nests OSM tags under `properties.extratags` and a structured
 * address under `properties.address` (the backend forwards
 * `extratags=1&addressdetails=1`). This differs from the Overpass shape in
 * `overpassFeature.ts`, so the extraction lives here.
 */
import type { GeoJSONFeature } from './nominatim';
import { asString } from './stringUtils';
import { translatePlaceType } from './placeTypes';
import { formatCuisine, formatOpeningHours, translateTagKey, translateTagValue } from './osmTags';

type Props = Record<string, unknown>;

export interface DetailRow {
  label: string;
  value: string;
  /**
   * An address shown as selectable text with a "Kopier" action. Never a link:
   * the app does not send its users to third-party sites.
   */
  copyable?: boolean;
}

/**
 * OSM `type` (else the `category`/class) in Norwegian — the same word the
 * result row showed a moment earlier ("By", not "city").
 */
const getCategory = (props: Props): string | undefined =>
  translatePlaceType(asString(props.type) ?? asString(props.category));

const cityOf = (address: Props): string | undefined =>
  asString(address.city) ?? asString(address.town) ?? asString(address.village) ?? asString(address.municipality);

/** Single line from Nominatim's structured `address`: road + number, then postcode + city. */
const getAddress = (address: Props | undefined): string | undefined => {
  if (!address) return undefined;
  const road = asString(address.road);
  const houseNumber = asString(address.house_number);
  const postcode = asString(address.postcode);
  const city = cityOf(address);

  const line1 = [road, houseNumber].filter(Boolean).join(' ');
  const line2 = [postcode, city].filter(Boolean).join(' ');
  const parts = [line1, line2].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(', ') : undefined;
};


/** A place as people say it: its own name, and where it is. */
export interface PlaceTitle {
  /** The headline: the place's own name, else its street address, else the first part of the long name. */
  title: string;
  /** Where it is, when the title does not already say so: "0184 Oslo", or the rest of the long name. */
  locality?: string;
  /** The title is the street address itself, so an address row would only repeat it. */
  titleIsAddress: boolean;
}

/**
 * The short name for headlines and place rows. Nominatim's `display_name` is a
 * database string in machine order ("Kaffebrenneriet, 12, Storgata, Sentrum,
 * Gamle Oslo, Oslo, 0184, Norge"); people say "Kaffebrenneriet" and look for
 * "0184 Oslo". Coordinates are a name of their own and are never split.
 */
export function getPlaceTitle(feature: GeoJSONFeature): PlaceTitle {
  const props = (feature.properties ?? {}) as Props;
  const displayName = asString(props.display_name) ?? '';
  const name = asString(props.name);
  const address = props.address as Props | undefined;
  const parts = displayName.split(',').map((part) => part.trim()).filter(Boolean);
  const rest = parts.slice(1).join(', ');

  if (!displayName || displayName.includes('°')) {
    return { title: displayName || name || '', titleIsAddress: false };
  }
  const place = address ? [asString(address.postcode), cityOf(address)].filter(Boolean).join(' ') : '';
  // A saved place carries its long name as `name` too; only a real name leads.
  if (name && name !== displayName) return { title: name, locality: place || rest || undefined, titleIsAddress: false };
  const road = address ? asString(address.road) : undefined;
  const houseNumber = address ? asString(address.house_number) : undefined;
  if (road && houseNumber) {
    return { title: `${road} ${houseNumber}`, locality: place || undefined, titleIsAddress: true };
  }
  // Nominatim writes a street address number first ("12, Storgata, Sentrum, …");
  // a long name with nothing else to go on still reads "Storgata 12".
  if (parts.length > 1 && /^\d+\s?[A-Za-z]?$/.test(parts[0])) {
    return { title: `${parts[1]} ${parts[0]}`, locality: parts.slice(2).join(', ') || undefined, titleIsAddress: true };
  }
  return { title: parts[0] ?? displayName, locality: rest || undefined, titleIsAddress: false };
}

/**
 * Short names for the stops of a route, from their long names alone and in the
 * same order: each stop's title, and where two different stops would read the
 * same ("Storgata" in Oslo and in Lillestrøm), as much of each one's locality
 * as tells them apart. A stop with no name stays undefined.
 */
export function shortStopNames(names: readonly (string | undefined)[]): (string | undefined)[] {
  const titles = names.map((name) =>
    name ? getPlaceTitle({ type: 'Feature', geometry: null, properties: { display_name: name } } as unknown as GeoJSONFeature) : undefined
  );
  const localityParts = (index: number): string[] =>
    (titles[index]?.locality ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const labelOf = (index: number, extra: number): string =>
    [titles[index]?.title ?? '', ...localityParts(index).slice(0, extra)].join(', ');

  return names.map((name, i) => {
    const title = titles[i];
    if (!name || !title) return undefined;
    const rivals = names.flatMap((other, j) =>
      j !== i && other && other !== name && titles[j]?.title === title.title ? [j] : []
    );
    if (rivals.length === 0) return title.title;
    for (let extra = 1; extra <= localityParts(i).length; extra++) {
      const label = labelOf(i, extra);
      if (rivals.every((j) => labelOf(j, extra) !== label)) return label;
    }
    return name;
  });
}

/**
 * `extratags` keys surfaced by `getDetailRows`. Exported so the sidebar's
 * "Flere detaljer" collapsible can exclude already-shown tags.
 */
export const CONSUMED_EXTRATAG_KEYS: readonly string[] = [
  'opening_hours',
  'phone',
  'contact:phone',
  'website',
  'contact:website',
  'wheelchair',
  'cuisine'
];

/** Ordered curated rows for the sidebar. Rows with no value are omitted. */
export function getDetailRows(feature: GeoJSONFeature): DetailRow[] {
  const props = (feature.properties ?? {}) as Props;
  const extratags = (props.extratags ?? {}) as Props;
  const address = props.address as Props | undefined;

  const rows: DetailRow[] = [];
  const push = (label: string, value: string | undefined, copyable = false) => {
    if (value) rows.push(copyable ? { label, value, copyable } : { label, value });
  };

  push('Kategori', getCategory(props));
  push('Adresse', getAddress(address));
  const openingHours = asString(extratags.opening_hours);
  push('Åpningstider', openingHours ? formatOpeningHours(openingHours) : undefined);
  push('Telefon', asString(extratags.phone) ?? asString(extratags['contact:phone']));
  push('Nettside', asString(extratags.website) ?? asString(extratags['contact:website']), true);
  const wheelchair = asString(extratags.wheelchair);
  push(
    'Rullestol',
    wheelchair ? (translateTagValue('wheelchair', wheelchair) ?? wheelchair.replace(/_/g, ' ')) : undefined
  );
  const cuisine = asString(extratags.cuisine);
  push('Kjøkken', cuisine ? formatCuisine(cuisine) : undefined);

  return rows;
}

/** One extratag for the "Flere detaljer" list. */
export interface ExtraTag {
  key: string;
  /** Norwegian label, or the OSM key itself when `raw`. */
  label: string;
  /** Norwegian value, or the OSM value itself when `raw`. */
  value: string;
  /** No Norwegian name exists: show it as an OSM tag, "key = value". */
  raw: boolean;
}

/**
 * Remaining `extratags` not already surfaced by `getDetailRows`, in order. A
 * tag with a Norwegian key and value comes back translated; anything else comes
 * back raw, so the card never mixes English labels into Norwegian ones.
 */
export function getExtraTags(feature: GeoJSONFeature): ExtraTag[] {
  const extratags = (feature.properties?.extratags ?? {}) as Props;
  const consumed = new Set(CONSUMED_EXTRATAG_KEYS);
  return Object.entries(extratags)
    .filter(([key]) => !consumed.has(key))
    .map(([key, rawValue]) => {
      const text = String(rawValue);
      const label = translateTagKey(key);
      const value = label ? translateTagValue(key, text) : undefined;
      return label && value !== undefined
        ? { key, label, value, raw: false }
        : { key, label: key, value: text, raw: true };
    });
}
