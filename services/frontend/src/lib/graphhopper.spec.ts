import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRoute, RouteError, parseDetails, parseElevation } from './graphhopper';
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

// New backend shape: { routes: [...], dashed_segments: [...] }
const ROUTE_RESPONSE = {
  routes: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[10.7, 59.9], [10.8, 60.0]] },
      properties: { distance: 1234, time: 600, primary: true, route_index: 0 },
    },
  ],
  dashed_segments: [],
};

const ALT_ROUTE_RESPONSE = {
  routes: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[10.7, 59.9], [10.8, 60.0]] },
      properties: { distance: 1234, time: 600, primary: true, route_index: 0 },
    },
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[10.7, 59.9], [10.9, 60.1]] },
      properties: { distance: 1500, time: 700, primary: false, route_index: 1 },
    },
  ],
  dashed_segments: [],
};

// Legacy FeatureCollection shape — getRoute must still tolerate it.
const LEGACY_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[10.7, 59.9], [10.8, 60.0]] },
      properties: { distance: 1234, time: 600 },
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(mapConfig, 'loadMapConfig').mockResolvedValue(TEST_CONFIG);
});

describe('getRoute', () => {
  it('returns null when fewer than 2 waypoints', async () => {
    const result = await getRoute([{ lat: 59.9, lng: 10.7 }]);
    expect(result).toBeNull();
  });

  it('constructs correct URL with from/to and default car profile', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE_RESPONSE)),
    );

    await getRoute([
      { lat: 59.9, lng: 10.7 },
      { lat: 60.0, lng: 10.8 },
    ]);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/route?');
    expect(url).toContain('from=59.9%2C10.7');
    expect(url).toContain('to=60%2C10.8');
    expect(url).toContain('profile=car');
  });

  it('uses foot profile when specified', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE_RESPONSE)),
    );

    await getRoute(
      [{ lat: 59.9, lng: 10.7 }, { lat: 60, lng: 10.8 }],
      { profile: 'foot' },
    );

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('profile=foot');
  });

  it('includes intermediate waypoints in URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE_RESPONSE)),
    );

    await getRoute([
      { lat: 59.9, lng: 10.7 },
      { lat: 59.95, lng: 10.75 },
      { lat: 60.0, lng: 10.8 },
    ]);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('waypoint=59.95%2C10.75');
  });

  it('returns parsed routes from the new response shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE_RESPONSE)),
    );

    const result = await getRoute([
      { lat: 59.9, lng: 10.7 },
      { lat: 60, lng: 10.8 },
    ]);

    expect(result).not.toBeNull();
    expect(result!.routes).toHaveLength(1);
    expect(result!.routes[0].distance).toBe(1234);
    expect(result!.routes[0].primary).toBe(true);
  });

  it('sends alternatives=true and parses multiple routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(ALT_ROUTE_RESPONSE)),
    );

    const result = await getRoute(
      [{ lat: 59.9, lng: 10.7 }, { lat: 60, lng: 10.8 }],
      { alternatives: true },
    );

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('alternatives=true');
    expect(result!.routes).toHaveLength(2);
    expect(result!.routes[1].primary).toBe(false);
    expect(result!.routes[1].routeIndex).toBe(1);
  });

  it('JSON-encodes avoid_areas polygons in the URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(ROUTE_RESPONSE)),
    );

    await getRoute(
      [{ lat: 59.9, lng: 10.7 }, { lat: 60, lng: 10.8 }],
      { avoidAreas: [[[10.7, 59.9], [10.8, 59.9], [10.8, 60.0]]] },
    );

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('avoid_areas=');
    const value = new URL(url, 'http://x').searchParams.get('avoid_areas');
    expect(JSON.parse(value!)).toEqual([[[10.7, 59.9], [10.8, 59.9], [10.8, 60.0]]]);
  });

  it('tolerates the legacy FeatureCollection response shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(LEGACY_RESPONSE)),
    );

    const result = await getRoute([
      { lat: 59.9, lng: 10.7 },
      { lat: 60, lng: 10.8 },
    ]);

    expect(result).not.toBeNull();
    expect(result!.routes).toHaveLength(1);
    expect(result!.routes[0].distance).toBe(1234);
  });

  it('throws a RouteError that names the cause on a 5xx without a body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 }));

    const err = await getRoute([
      { lat: 59.9, lng: 10.7 },
      { lat: 60.0, lng: 10.8 },
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(RouteError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Kunne ikke beregne ruten. Rutetjenesten svarte med en feil.');
  });
});

describe('getRoute error mapping', () => {
  const two = [
    { lat: 59.9, lng: 10.7 },
    { lat: 60.0, lng: 10.8 }
  ];

  it('resolves null (no route) when the backend answers 400 with an error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Connection between locations not found' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    );
    await expect(getRoute(two)).resolves.toBeNull();
  });

  it('never passes the backend detail on: a 5xx answer says the service does not answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Kunne ikke kontakte rutetjenesten' }), {
        status: 502,
        headers: { 'content-type': 'application/json' }
      })
    );
    const err = await getRoute(two).catch((e) => e);
    expect(err).toBeInstanceOf(RouteError);
    expect(err.status).toBe(502);
    expect(err.message).toBe('Kunne ikke beregne ruten. Rutetjenesten svarer ikke.');
  });

  it('names the API key when the backend says the routing service refused it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: 'Rutetjenesten avviste API-nøkkelen (sjekk GRAPHHOPPER_API_KEY)',
          code: 'graphhopper_key_rejected'
        }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      )
    );
    const err = await getRoute(two).catch((e) => e);
    expect(err).toBeInstanceOf(RouteError);
    expect(err.status).toBe(502);
    // The frontend's own sentence, not the backend's text: no variable names.
    expect(err.message).toBe('Kunne ikke beregne ruten. Rutetjenesten avviste API-nøkkelen.');
  });

  it('says the key quota is used up when the backend reports it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: 'Rutetjenesten melder at kvoten for API-nøkkelen er brukt opp',
          code: 'graphhopper_key_quota'
        }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      )
    );
    const err = await getRoute(two).catch((e) => e);
    expect(err).toBeInstanceOf(RouteError);
    expect(err.message).toBe('Kunne ikke beregne ruten. Kvoten for API-nøkkelen er brukt opp.');
  });

  it('ignores an unknown code on a 502 answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'x', code: 'something_else' }), { status: 502 })
    );
    const err = await getRoute(two).catch((e) => e);
    expect(err.message).toBe('Kunne ikke beregne ruten. Rutetjenesten svarer ikke.');
  });

  it('throws a RouteError saying the service does not answer when a gateway error has no JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>Gateway Time-out</html>', { status: 504 })
    );
    const err = await getRoute(two).catch((e) => e);
    expect(err).toBeInstanceOf(RouteError);
    expect(err.status).toBe(504);
    expect(err.message).toBe('Kunne ikke beregne ruten. Rutetjenesten svarer ikke.');
  });

  it('waits longer than the 15 s default so slow flexible routes are not cut off', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
        (_url, init) =>
          new Promise((resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
            setTimeout(() => resolve(new Response(JSON.stringify(ROUTE_RESPONSE))), 25_000);
          })
      );
      const pending = getRoute(two);
      await vi.advanceTimersByTimeAsync(25_100);
      await expect(pending).resolves.not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('route details parsing', () => {
  it('keeps heights only when there is one finite number per coordinate', () => {
    expect(parseElevation([20, 25.5, 30], 3)).toEqual([20, 25.5, 30]);
    expect(parseElevation([20, 25.5], 3)).toBeUndefined();
    expect(parseElevation([20, null, 30], 3)).toBeUndefined();
    expect(parseElevation([20, Number.NaN, 30], 3)).toBeUndefined();
    expect(parseElevation('high', 3)).toBeUndefined();
  });

  it('keeps known details, clamps intervals and drops empty or malformed ones', () => {
    const details = parseDetails(
      {
        surface: [[0, 2, 'asphalt'], [2, 9, 'gravel'], [3, 3, 'sand'], ['x', 1, 'dirt']],
        max_speed: [[0, 1, null], [1, 2, 30]],
        hgv: [[0, 2, 'yes']],
        road_class: 'residential'
      },
      4
    );
    expect(details).toEqual({
      surface: [[0, 2, 'asphalt'], [2, 3, 'gravel']],
      max_speed: [[0, 1, null], [1, 2, 30]]
    });
    expect(parseDetails({ hgv: [[0, 1, 'yes']] }, 2)).toBeUndefined();
    expect(parseDetails(null, 2)).toBeUndefined();
  });

  it('carries elevation, ascend, descend and details from the backend onto the route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          routes: [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: [[10.7, 59.9], [10.71, 59.91], [10.72, 59.92]] },
              properties: {
                distance: 240,
                time: 60000,
                primary: true,
                route_index: 0,
                elevation: [20, 25.5, 30],
                ascend: 10,
                descend: 0,
                details: { surface: [[0, 1, 'asphalt'], [1, 2, 'gravel']] }
              }
            }
          ],
          dashed_segments: []
        })
      )
    );
    const result = await getRoute([
      { lat: 59.9, lng: 10.7 },
      { lat: 59.92, lng: 10.72 }
    ]);
    const route = result!.routes[0];
    expect(route.elevation).toEqual([20, 25.5, 30]);
    expect(route.ascend).toBe(10);
    expect(route.descend).toBe(0);
    expect(route.details).toEqual({ surface: [[0, 1, 'asphalt'], [1, 2, 'gravel']] });
  });

  it('leaves a plain route exactly as before', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(ROUTE_RESPONSE)));
    const result = await getRoute([
      { lat: 59.9, lng: 10.7 },
      { lat: 60.0, lng: 10.8 }
    ]);
    const route = result!.routes[0];
    expect('elevation' in route).toBe(false);
    expect('ascend' in route).toBe(false);
    expect('details' in route).toBe(false);
  });
});
