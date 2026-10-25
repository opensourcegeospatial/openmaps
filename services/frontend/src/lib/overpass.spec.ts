import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchOverpass } from './overpass';
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

describe('searchOverpass', () => {
  it('constructs correct URL with query and bounds from config', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] })),
    );

    const bounds: [number, number, number, number] = [10.5, 59.8, 10.9, 60.1];
    await searchOverpass('restaurants', bounds);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url.startsWith('/api/overpass?')).toBe(true);
    expect(url).toContain('nl=restaurants');
    expect(url).toContain('south=59.8');
    expect(url).toContain('west=10.5');
    expect(url).toContain('north=60.1');
    expect(url).toContain('east=10.9');
  });

  it('returns features from response', async () => {
    const features = [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [10.7, 59.9] }, properties: { name: 'Cafe' } },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ features })),
    );

    const result = await searchOverpass('cafes', [10, 59, 11, 60]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties?.name).toBe('Cafe');
    expect(result.generator).toBeUndefined();
  });

  it('returns empty array when no features', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] })),
    );

    const result = await searchOverpass('nothing', [0, 0, 1, 1]);
    expect(result).toEqual({ features: [], generator: undefined });
  });

  it('keeps the backend\'s own message out of the UI, even when it is Norwegian', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Kunne ikke kontakte Overpass-tjenesten' }), {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(searchOverpass('test', [0, 0, 1, 1])).rejects.toThrow(
      'Søket i området kunne ikke utføres. Søketjenesten svarer ikke.',
    );
  });

  it('never shows the English/empty statusText when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>Gateway Time-out</html>', { status: 504, statusText: '' }),
    );

    await expect(searchOverpass('test', [0, 0, 1, 1])).rejects.toThrow(
      'Søket i området kunne ikke utføres. Søketjenesten svarer ikke.',
    );
  });

  it('rejects a 200 whose body has no features array instead of returning undefined', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [] })),
    );

    await expect(searchOverpass('test', [0, 0, 1, 1])).rejects.toThrow(
      'Ugyldig svar fra Overpass-tjenesten',
    );
  });

  it('uses config apiEndpoints.overpass for base URL', async () => {
    const customConfig = {
      ...TEST_CONFIG,
      apiEndpoints: {
        ...TEST_CONFIG.apiEndpoints,
        overpass: '/custom/overpass-endpoint',
      },
    };
    vi.mocked(mapConfig.loadMapConfig).mockResolvedValue(customConfig);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] })),
    );

    await searchOverpass('parks', [0, 0, 1, 1]);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url.startsWith('/custom/overpass-endpoint?')).toBe(true);
  });
});

describe('searchOverpass cancellation', () => {
  it('aborts the underlying request when the caller\'s signal aborts', async () => {
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          requestSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const controller = new AbortController();

    const pending = searchOverpass('cafes', [0, 0, 1, 1], controller.signal).catch((e) => e);
    // Let searchOverpass reach fetch (it awaits the config first).
    await new Promise((r) => setTimeout(r, 0));
    expect(requestSignal?.aborted).toBe(false);

    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
    const err = await pending;
    expect(err.name).toBe('AbortError');
  });
});

describe('searchOverpass engine', () => {
  it('passes on which engine read the question, and ignores anything unknown', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [], generator: 'byt5' })),
    );
    expect((await searchOverpass('kafé', [0, 0, 1, 1])).generator).toBe('byt5');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [], generator: 'banana' })),
    );
    expect((await searchOverpass('kafé', [0, 0, 1, 1])).generator).toBeUndefined();
  });
});
