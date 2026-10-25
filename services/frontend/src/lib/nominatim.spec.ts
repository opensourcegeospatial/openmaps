import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Geocode, ReverseGeocode, formatViewbox } from './nominatim';
import * as mapConfig from '../config/map.config';

const TEST_CONFIG: mapConfig.MapConfig = {
  defaultZoom: 15,
  defaultCenter: { lng: 0, lat: 0 },
  styles: [],
  apiEndpoints: {
    graphhopper: '/api/route',
    nominatim: { search: '/api/search', reverse: '/api/reverse' },
    overpass: '/api/overpass',
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(mapConfig, 'loadMapConfig').mockResolvedValue(TEST_CONFIG);
});

describe('Geocode', () => {
  it('returns empty array for blank query', async () => {
    const result = await Geocode('   ');
    expect(result).toEqual([]);
  });

  it('constructs correct URL from config and query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 59] }, properties: { display_name: 'Oslo' } }],
        }),
      ),
    );

    await Geocode('Oslo');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/search?q=Oslo',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('encodes special characters in query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: 'FeatureCollection', features: [] }),
      ),
    );

    await Geocode('café & bar');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('q=caf%C3%A9%20%26%20bar');
  });

  it('sends the map view as a viewbox when given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })),
    );

    await Geocode('Storgata', { viewbox: { north: 60.0, south: 59.8, east: 10.9, west: 10.5 } });

    expect(fetchSpy.mock.calls[0][0]).toBe('/api/search?q=Storgata&viewbox=10.5,59.8,10.9,60');
  });

  it('omits the viewbox when the view is missing or unusable', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }))),
      );

    await Geocode('Oslo', { viewbox: null });
    await Geocode('Oslo', { viewbox: { north: NaN, south: 59, east: 11, west: 10 } });

    expect(fetchSpy.mock.calls[0][0]).toBe('/api/search?q=Oslo');
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/search?q=Oslo');
  });

  it('returns features from valid GeoJSON response', async () => {
    const features = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 59] }, properties: { name: 'A' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11, 60] }, properties: { name: 'B' } },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'FeatureCollection', features })),
    );

    const result = await Geocode('test');
    expect(result).toHaveLength(2);
    expect(result[0].properties?.name).toBe('A');
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 500 }),
    );

    await expect(Geocode('test')).rejects.toThrow('Søket kunne ikke utføres. Søketjenesten svarte med en feil.');
  });

  it('throws on invalid GeoJSON (missing features)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'FeatureCollection' })),
    );

    await expect(Geocode('test')).rejects.toThrow('Ugyldig GeoJSON-svar');
  });
});

describe('ReverseGeocode', () => {
  it('constructs correct URL with lat/lon from config', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10.7, 59.9] }, properties: {} }],
        }),
      ),
    );

    await ReverseGeocode(59.9, 10.7);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/reverse?lat=59.9&lon=10.7',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('returns the first feature from response', async () => {
    const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 59] }, properties: { name: 'Place' } };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: 'FeatureCollection', features: [feature] }),
      ),
    );

    const result = await ReverseGeocode(59, 10);
    expect(result).not.toBeNull();
    expect(result!.properties?.name).toBe('Place');
  });

  it('returns null when response has no features', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: 'FeatureCollection', features: [] }),
      ),
    );

    const result = await ReverseGeocode(0, 0);
    expect(result).toBeNull();
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 403 }),
    );

    await expect(ReverseGeocode(59, 10)).rejects.toThrow(
      'Kunne ikke hente adressen for punktet. Adressetjenesten svarte med en feil.'
    );
  });
});

describe('formatViewbox', () => {
  it('rounds to five decimals in west,south,east,north order', () => {
    expect(formatViewbox({ north: 60.123456, south: 59.9, east: 11.000001, west: 10.5 })).toBe(
      '10.5,59.9,11,60.12346',
    );
  });

  it('clamps the wrapped longitudes a zoomed-out map reports', () => {
    expect(formatViewbox({ north: 85, south: -85, east: 250, west: -250 })).toBe('-180,-85,180,85');
  });

  it('rejects non-finite or inverted views', () => {
    expect(formatViewbox(null)).toBeNull();
    expect(formatViewbox(undefined)).toBeNull();
    expect(formatViewbox({ north: 59, south: 60, east: 11, west: 10 })).toBeNull();
    expect(formatViewbox({ north: 60, south: 59, east: 11, west: Infinity })).toBeNull();
  });
});
