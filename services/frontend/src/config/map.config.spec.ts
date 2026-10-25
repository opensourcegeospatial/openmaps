import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadMapConfig } from './map.config';

// We always forceReload to bypass the module-level cache between tests.

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('loadMapConfig', () => {
  it('returns parsed config when fetch succeeds with valid JSON', async () => {
    const fakeConfig = {
      defaultZoom: 10,
      defaultCenter: { lng: 1.5, lat: 2.5 },
      styles: [{ id: 'test', name: 'Test', url: 'mapbox://test' }],
      apiEndpoints: {
        graphhopper: '/custom/route',
        nominatim: { search: '/custom/search', reverse: '/custom/reverse' },
        overpass: '/custom/overpass',
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(fakeConfig), { status: 200 }),
    );

    const config = await loadMapConfig(true);

    expect(config.defaultZoom).toBe(10);
    expect(config.defaultCenter).toEqual({ lng: 1.5, lat: 2.5 });
    expect(config.apiEndpoints.graphhopper).toBe('/custom/route');
    expect(config.apiEndpoints.nominatim.search).toBe('/custom/search');
    expect(config.apiEndpoints.overpass).toBe('/custom/overpass');
    expect(config.styles).toHaveLength(1);
  });

  it('tries multiple CONFIG_LOCATIONS and uses the first successful one', async () => {
    const fakeConfig = {
      defaultZoom: 8,
      defaultCenter: { lng: 3, lat: 4 },
      styles: [],
      apiEndpoints: {
        graphhopper: '/api/route',
        nominatim: { search: '/api/search', reverse: '/api/reverse' },
        overpass: '/api/overpass',
      },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // First location fails
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      // Second location succeeds
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fakeConfig), { status: 200 }),
      );

    const config = await loadMapConfig(true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(config.defaultZoom).toBe(8);
  });

  it('returns fallback config when all fetch locations fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 404 }),
    );

    const config = await loadMapConfig(true);

    // Fallback defaults
    expect(config.defaultZoom).toBe(12);
    expect(config.defaultCenter).toEqual({ lng: 10.7446, lat: 59.9127 });
    expect(config.apiEndpoints.graphhopper).toBe('/api/route');
    expect(config.apiEndpoints.nominatim.search).toBe('/api/search');
  });

  it('returns fallback config when response is malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json at all {{{', { status: 200 }),
    );

    const config = await loadMapConfig(true);

    expect(config.defaultZoom).toBe(12);
    expect(config.defaultCenter).toEqual({ lng: 10.7446, lat: 59.9127 });
  });

  it('uses default values for missing/invalid fields in config JSON', async () => {
    // Partial config — missing defaultCenter, styles is not an array
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ defaultZoom: 5, styles: 'bad' }), {
        status: 200,
      }),
    );

    const config = await loadMapConfig(true);

    expect(config.defaultZoom).toBe(5);
    // Missing defaultCenter falls back to Oslo
    expect(config.defaultCenter).toEqual({ lng: 10.7446, lat: 59.9127 });
    // Invalid styles falls back to []
    expect(config.styles).toEqual([]);
    // Missing apiEndpoints falls back to defaults
    expect(config.apiEndpoints.graphhopper).toBe('/api/route');
  });

  it('falls back to zoom 12 when the config JSON has no defaultZoom', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ defaultCenter: { lng: 5, lat: 6 } }), { status: 200 }),
    );

    const config = await loadMapConfig(true);

    expect(config.defaultZoom).toBe(12);
    expect(config.defaultCenter).toEqual({ lng: 5, lat: 6 });
  });

  it('returns fallback config when fetch throws a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );

    const config = await loadMapConfig(true);

    expect(config.defaultZoom).toBe(12);
  });

  it('normalizes streetview config from JSON', async () => {
    const fakeConfig = {
      defaultZoom: 12,
      defaultCenter: { lng: 0, lat: 0 },
      streetview: {
        enabled: true,
        tilesUrl: 'https://tiles.example.com',
        panoramaUrl: 'https://pano.example.com',
        minZoom: 10,
        maxZoom: 18,
        bounds: [1, 2, 3, 4],
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(fakeConfig), { status: 200 }),
    );

    const config = await loadMapConfig(true);

    expect(config.streetview).toBeDefined();
    expect(config.streetview!.enabled).toBe(true);
    expect(config.streetview!.tilesUrl).toBe('https://tiles.example.com');
    expect(config.streetview!.bounds).toEqual([1, 2, 3, 4]);
    expect(config.streetview!.minZoom).toBe(10);
  });

  it('parses a valid theme object, keeping only string values', async () => {
    const fakeConfig = {
      defaultZoom: 12,
      defaultCenter: { lng: 0, lat: 0 },
      theme: {
        primary: '#aabbcc',
        surface: '#f4f4f5',
        danger: '#ff00ff',
        routePrimary: '#112233',
        markerTo: '#ff0000',
        routeAlternative: 42, // non-string → ignored
        unknownKey: '#000000', // unknown → ignored
        markerFrom: '' // empty → ignored
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(fakeConfig), { status: 200 }),
    );

    const config = await loadMapConfig(true);

    expect(config.theme).toBeDefined();
    expect(config.theme!.primary).toBe('#aabbcc');
    expect(config.theme!.surface).toBe('#f4f4f5');
    expect(config.theme!.danger).toBe('#ff00ff');
    expect(config.theme!.routePrimary).toBe('#112233');
    expect(config.theme!.markerTo).toBe('#ff0000');
    expect(config.theme!.routeAlternative).toBeUndefined();
    expect(config.theme!.markerFrom).toBeUndefined();
    expect((config.theme as Record<string, unknown>).unknownKey).toBeUndefined();
  });

  it('drops theme values that are not valid 6-digit hex', async () => {
    const fakeConfig = {
      defaultZoom: 12,
      theme: { primary: 'purple', surface: '#fff', danger: '#ff00ff' }
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(fakeConfig), { status: 200 })
    );
    const config = await loadMapConfig(true);
    expect(config.theme).toEqual({ danger: '#ff00ff' });
  });

  it('omits theme entirely when absent or invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ defaultZoom: 9, theme: 'nope' }), { status: 200 }),
    );

    const config = await loadMapConfig(true);
    expect(config.theme).toBeUndefined();
  });

  it('defaults healthDashboardEnabled to true when absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ defaultZoom: 9 }), { status: 200 }),
    );
    const config = await loadMapConfig(true);
    expect(config.healthDashboardEnabled).toBe(true);
  });

  it('honors healthDashboardEnabled=false from config', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ defaultZoom: 9, healthDashboardEnabled: false }), { status: 200 }),
    );
    const config = await loadMapConfig(true);
    expect(config.healthDashboardEnabled).toBe(false);
  });

  it('returns cached config on subsequent calls without forceReload', async () => {
    const fakeConfig = {
      defaultZoom: 7,
      defaultCenter: { lng: 5, lat: 6 },
      styles: [],
      apiEndpoints: {
        graphhopper: '/r',
        nominatim: { search: '/s', reverse: '/rv' },
        overpass: '/o',
      },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(fakeConfig), { status: 200 }),
    );

    // First call populates cache
    const first = await loadMapConfig(true);
    // Second call should use cache
    const second = await loadMapConfig(false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });
});
