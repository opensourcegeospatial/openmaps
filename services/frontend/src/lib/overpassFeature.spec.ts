import { describe, it, expect } from 'vitest';
import {
  getCategory,
  getDisplayName,
  getAddress,
  getSubtitle,
  toPlaceFeature
} from './overpassFeature';
import { getDetailRows } from './featureDetails';
import type { GeoJSONFeature } from './nominatim';

const point = (props: Record<string, unknown>): GeoJSONFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [10, 60] },
  properties: props
});

describe('getCategory', () => {
  it('returns the primary OSM category with underscores normalized', () => {
    expect(getCategory({ amenity: 'fast_food' })).toBe('Gatekjøkken');
    expect(getCategory({ shop: 'bakery' })).toBe('Bakeri');
  });

  it('returns undefined when no category tag is present', () => {
    expect(getCategory({ name: 'X' })).toBeUndefined();
    expect(getCategory(null)).toBeUndefined();
  });
});

describe('getDisplayName', () => {
  it('prefers name, falls back to category, then to "Ingen navn"', () => {
    expect(getDisplayName(point({ name: 'Kafé', amenity: 'cafe' }))).toBe('Kafé');
    expect(getDisplayName(point({ amenity: 'cafe' }))).toBe('Kafé');
    expect(getDisplayName(point({}))).toBe('Ingen navn');
  });
});

describe('getAddress', () => {
  it('combines street + housenumber + city', () => {
    expect(
      getAddress({ 'addr:street': 'Storgata', 'addr:housenumber': '1', 'addr:city': 'Oslo' })
    ).toBe('Storgata 1, Oslo');
  });

  it('returns undefined when no address tags exist', () => {
    expect(getAddress({ name: 'X' })).toBeUndefined();
  });
});

describe('getSubtitle', () => {
  it('does not repeat the category under an unnamed feature', () => {
    expect(getSubtitle(point({ amenity: 'pharmacy' }))).toBeUndefined();
    expect(getSubtitle(point({ amenity: 'pharmacy', 'addr:city': 'Oslo' }))).toBe('Oslo');
  });

  it('joins category and address, not repeating a name-equal category', () => {
    expect(getSubtitle(point({ name: 'X', amenity: 'cafe', 'addr:city': 'Oslo' }))).toBe(
      'Kafé · Oslo'
    );
  });
});

describe('toPlaceFeature', () => {
  it('reshapes a hit into the place shape the details card reads', () => {
    const place = toPlaceFeature(
      point({
        name: 'Vitusapotek',
        amenity: 'pharmacy',
        'addr:street': 'Storgata',
        'addr:housenumber': '5',
        'addr:city': 'Oslo',
        opening_hours: 'Mo-Fr 08:00-16:00',
        website: 'https://example.com'
      }),
      3
    );
    expect(place.properties).toMatchObject({
      display_name: 'Vitusapotek, Storgata 5, Oslo',
      name: 'Vitusapotek',
      category: 'amenity',
      type: 'pharmacy',
      address: { road: 'Storgata', house_number: '5', city: 'Oslo' },
      extratags: { opening_hours: 'Mo-Fr 08:00-16:00', website: 'https://example.com' },
      __overpassIndex: 3
    });
    expect(getDetailRows(place).map((row) => row.label)).toEqual(['Kategori', 'Adresse', 'Åpningstider', 'Nettside']);
  });

  it('gives an area a bounding box, so it can be saved and routed to', () => {
    const place = toPlaceFeature(
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[10, 60], [10.2, 60], [10.2, 60.1], [10, 60]]] },
        properties: { amenity: 'pharmacy' }
      },
      0
    );
    expect(place.bbox).toEqual([10, 60, 10.2, 60.1]);
    expect(place.properties?.display_name).toBe('Apotek');
  });
});
