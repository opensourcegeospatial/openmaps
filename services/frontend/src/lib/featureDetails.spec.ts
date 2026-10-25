import { describe, it, expect } from 'vitest';
import { getDetailRows, getExtraTags, getPlaceTitle, shortStopNames } from './featureDetails';
import type { GeoJSONFeature } from './nominatim';

const feature = (props: Record<string, unknown>): GeoJSONFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [10, 60] },
  properties: props
});

describe('getDetailRows', () => {
  it('returns curated rows in fixed order for a full POI', () => {
    const rows = getDetailRows(
      feature({
        type: 'restaurant',
        category: 'amenity',
        address: { road: 'Storgata', house_number: '1', postcode: '0155', city: 'Oslo' },
        extratags: {
          opening_hours: 'Mo-Fr 09:00-17:00',
          phone: '+47 123',
          website: 'example.no',
          wheelchair: 'limited',
          cuisine: 'italian_pizza'
        }
      })
    );
    expect(rows).toEqual([
      { label: 'Kategori', value: 'Restaurant' },
      { label: 'Adresse', value: 'Storgata 1, 0155 Oslo' },
      { label: 'Åpningstider', value: 'man.–fre. 09:00–17:00' },
      { label: 'Telefon', value: '+47 123' },
      { label: 'Nettside', value: 'example.no', copyable: true },
      { label: 'Rullestol', value: 'Begrenset' },
      { label: 'Kjøkken', value: 'Italian pizza' }
    ]);
  });

  it('returns an empty list for a bare feature', () => {
    expect(getDetailRows(feature({}))).toEqual([]);
  });

  it('builds an address with no postcode', () => {
    const rows = getDetailRows(
      feature({ address: { road: 'Storgata', house_number: '2', city: 'Bergen' } })
    );
    expect(rows).toEqual([{ label: 'Adresse', value: 'Storgata 2, Bergen' }]);
  });

  it('falls back to contact:* tags for phone and website', () => {
    const rows = getDetailRows(
      feature({ extratags: { 'contact:phone': '111', 'contact:website': 'foo.no' } })
    );
    expect(rows).toEqual([
      { label: 'Telefon', value: '111' },
      { label: 'Nettside', value: 'foo.no', copyable: true }
    ]);
  });

  it('names wheelchair access in Norwegian and keeps an unknown value readable', () => {
    expect(getDetailRows(feature({ extratags: { wheelchair: 'designated' } }))).toEqual([
      { label: 'Rullestol', value: 'Tilrettelagt' }
    ]);
    expect(getDetailRows(feature({ extratags: { wheelchair: 'ramp_only' } }))).toEqual([
      { label: 'Rullestol', value: 'ramp only' }
    ]);
  });

  it('leaves the category out when OSM gives no Norwegian name for it', () => {
    expect(getDetailRows(feature({ category: 'amenity' }))).toEqual([]);
    expect(getDetailRows(feature({ type: 'Point' }))).toEqual([]);
  });

  it('uses municipality as the city fallback', () => {
    const rows = getDetailRows(
      feature({ address: { road: 'Storgata', municipality: 'Stavanger' } })
    );
    expect(rows).toEqual([{ label: 'Adresse', value: 'Storgata, Stavanger' }]);
  });

  it('builds an address with no road, only postcode and city', () => {
    const rows = getDetailRows(feature({ address: { postcode: '5003', city: 'Bergen' } }));
    expect(rows).toEqual([{ label: 'Adresse', value: '5003 Bergen' }]);
  });
});

describe('getExtraTags', () => {
  it('translates the tags it can name and keeps the rest as raw OSM tags', () => {
    const f = feature({
      extratags: {
        opening_hours: 'x',
        description: 'Fin kafé',
        ele: 12,
        check_date: '2025-03-01',
        healthcare: 'pharmacy',
        'payment:cash': 'yes',
        'roof:shape': 'flat'
      }
    });
    expect(getExtraTags(f)).toEqual([
      { key: 'description', label: 'Beskrivelse', value: 'Fin kafé', raw: false },
      { key: 'ele', label: 'Høyde over havet', value: '12', raw: false },
      { key: 'check_date', label: 'Sist kontrollert', value: '1. mars 2025', raw: false },
      { key: 'healthcare', label: 'Helsetjeneste', value: 'Apotek', raw: false },
      { key: 'payment:cash', label: 'Betaling, kontant', value: 'Ja', raw: false },
      { key: 'roof:shape', label: 'roof:shape', value: 'flat', raw: true }
    ]);
  });

  it('returns an empty list when there are no extratags', () => {
    expect(getExtraTags(feature({}))).toEqual([]);
  });
});

describe('getPlaceTitle', () => {
  const placeFeature = (properties: Record<string, unknown>) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [10.75, 59.91] },
    properties
  });
  const kaffe = {
    display_name: 'Kaffebrenneriet, 12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge',
    address: { road: 'Storgata', house_number: '12', postcode: '0184', city: 'Oslo' }
  };

  it('headlines the name and places it by postcode and town', () => {
    expect(getPlaceTitle(placeFeature({ ...kaffe, name: 'Kaffebrenneriet' }))).toEqual({
      title: 'Kaffebrenneriet',
      locality: '0184 Oslo',
      titleIsAddress: false
    });
  });

  it('headlines the street address when there is no name, so the address row can go', () => {
    expect(getPlaceTitle(placeFeature({ ...kaffe, display_name: '12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge' }))).toEqual({
      title: 'Storgata 12',
      locality: '0184 Oslo',
      titleIsAddress: true
    });
  });

  it('splits a stored long name at its first comma', () => {
    expect(getPlaceTitle(placeFeature({ display_name: 'Oslo, Norge', name: 'Oslo, Norge' }))).toEqual({
      title: 'Oslo',
      locality: 'Norge',
      titleIsAddress: false
    });
  });

  it('never splits coordinates', () => {
    const coordinates = '59,91270° N, 10,74460° Ø';
    expect(getPlaceTitle(placeFeature({ display_name: coordinates }))).toEqual({ title: coordinates, titleIsAddress: false });
  });

  it('reads a street address written number first from the long name alone', () => {
    expect(getPlaceTitle(placeFeature({ display_name: '12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge' }))).toEqual({
      title: 'Storgata 12',
      locality: 'Sentrum, Gamle Oslo, Oslo, 0184, Norge',
      titleIsAddress: true
    });
  });
});

describe('shortStopNames', () => {
  it('names each stop by its title', () => {
    expect(
      shortStopNames([
        'Kaffebrenneriet Storgata, 12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge',
        undefined,
        '7, Abels gate, Sluppen, Trondheim, Trøndelag, 7030, Norge'
      ])
    ).toEqual(['Kaffebrenneriet Storgata', undefined, 'Abels gate 7']);
  });

  it('tells apart different stops that would read the same, with as much locality as it takes', () => {
    expect(
      shortStopNames([
        'Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge',
        'Storgata, Lillestrøm, Akershus, Norge',
        'Storgata, Sentrum, Tromsø, Troms, Norge',
        'Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge'
      ])
    ).toEqual(['Storgata, Sentrum, Gamle Oslo', 'Storgata, Lillestrøm', 'Storgata, Sentrum, Tromsø', 'Storgata, Sentrum, Gamle Oslo']);
  });

  it('never splits coordinates', () => {
    expect(shortStopNames(['59,91270° N, 10,74460° Ø'])).toEqual(['59,91270° N, 10,74460° Ø']);
  });
});
