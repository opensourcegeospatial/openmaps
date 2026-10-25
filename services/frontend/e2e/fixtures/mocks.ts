import type { Page, Route, Request } from '@playwright/test';

/**
 * Hermetic network mocking for the OpenMaps frontend e2e suite.
 *
 * Every external dependency the app touches at runtime is intercepted here so
 * the tests run fully offline, without the Docker stack and without internet:
 *   - the runtime `config.json` fetch (see src/config/map.config.ts)
 *   - raster/vector map tiles (tileserver + any remote basemap)
 *   - the backend API: /config, /health, /search, /reverse, /route,
 *     /streetview/*, /overpass
 *
 * The mocks are intentionally permissive: anything not explicitly matched is
 * fulfilled with an empty 200 so a stray request can never hang a test or hit
 * the network.
 */

// A 1x1 fully transparent PNG (base64): 8-bit grey+alpha, grey 0, alpha 0.
// Serves every raster tile and the street-view panorama. Generated with
// zlib/struct and checked by decoding it back (chunk CRCs valid, strict
// zlib.decompress succeeds, alpha 0). An earlier hand-typed string here decoded
// to opaque black, which made every screenshot of the mocked map black.
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_BASE64, 'base64');

/**
 * Runtime config returned for every `config.json` request. API endpoints point
 * at the same relative paths the production config uses, all of which are
 * mocked below. A small, fixed style list keeps the style-selector + layer
 * controls deterministic. Streetview is enabled so its layer/control mount.
 */
export const MOCK_CONFIG = {
  defaultZoom: 13,
  defaultCenter: { lng: 10.7446, lat: 59.9127 },
  styles: [
    {
      id: 'local',
      name: 'Lokale kartfliser',
      url: '/tiles/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap-bidragsytere'
    },
    {
      id: 'osm',
      name: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap-bidragsytere'
    }
  ],
  apiEndpoints: {
    graphhopper: '/api/route',
    nominatim: {
      search: '/api/search',
      reverse: '/api/reverse'
    },
    overpass: '/api/overpass'
  },
  streetview: {
    enabled: true,
    geoJsonUrl: '/streetview/api/panoramas',
    panoramaUrl: '/streetview/panorama/{id}',
    metadataUrl: '/streetview/metadata/{id}'
  }
};

/** Two Nominatim-style search results (GeoJSON FeatureCollection). */
export const MOCK_SEARCH = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'osm-1',
      bbox: [10.7, 59.9, 10.76, 59.93],
      geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
      properties: {
        osm_type: 'node',
        osm_id: 1001,
        place_id: 1001,
        display_name: 'Oslo, Norge',
        name: 'Oslo',
        type: 'city'
      }
    },
    {
      type: 'Feature',
      id: 'osm-2',
      bbox: [10.74, 59.91, 10.75, 59.92],
      geometry: { type: 'Point', coordinates: [10.7461, 59.9111] },
      properties: {
        osm_type: 'node',
        osm_id: 1002,
        place_id: 1002,
        display_name: 'Oslo Sentralstasjon, Oslo, Norge',
        name: 'Oslo S',
        type: 'station'
      }
    }
  ]
};

/** Reverse geocode result (single feature wrapped in a FeatureCollection). */
export const MOCK_REVERSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
      properties: {
        display_name: 'Et sted i Oslo, Norge',
        name: 'Et sted',
        type: 'point'
      }
    }
  ]
};

const PRIMARY_GEOMETRY = {
  type: 'LineString' as const,
  coordinates: [
    [10.7522, 59.9139],
    [10.7505, 59.9125],
    [10.7461, 59.9111]
  ]
};

const ALTERNATIVE_GEOMETRY = {
  type: 'LineString' as const,
  coordinates: [
    [10.7522, 59.9139],
    [10.756, 59.913],
    [10.7461, 59.9111]
  ]
};

const PRIMARY_INSTRUCTIONS = [
  { text: 'Kjør mot sørvest', distance: 1200, time: 90000, interval: [0, 1] },
  { text: 'Ta til høyre', distance: 800, time: 60000, interval: [1, 2] },
  { text: 'Du er fremme ved destinasjonen', distance: 0, time: 0, interval: [2, 2] }
];

/** Single-route response in the NEW `{ routes, dashed_segments }` shape. */
export const MOCK_ROUTE_SINGLE = {
  routes: [
    {
      type: 'Feature',
      geometry: PRIMARY_GEOMETRY,
      properties: {
        distance: 2000,
        time: 150000,
        instructions: PRIMARY_INSTRUCTIONS,
        primary: true,
        route_index: 0,
        style: 'solid'
      }
    }
  ],
  dashed_segments: [
    [
      [10.7522, 59.9139],
      [10.7523, 59.914]
    ]
  ]
};

/** Multi-route response: primary + one alternative (style 'alternative'). */
export const MOCK_ROUTE_MULTI = {
  routes: [
    {
      type: 'Feature',
      geometry: PRIMARY_GEOMETRY,
      properties: {
        distance: 2000,
        time: 150000,
        instructions: PRIMARY_INSTRUCTIONS,
        primary: true,
        route_index: 0,
        style: 'solid'
      }
    },
    {
      type: 'Feature',
      geometry: ALTERNATIVE_GEOMETRY,
      properties: {
        distance: 2600,
        time: 180000,
        instructions: [
          { text: 'Kjør via omkjøringen', distance: 2600, time: 180000, interval: [0, 2] }
        ],
        primary: false,
        route_index: 1,
        style: 'alternative'
      }
    }
  ],
  dashed_segments: []
};

/**
 * A route with everything GraphHopper can describe (critique run 16 follow-up):
 * eleven evenly spaced points west from Oslo S, heights, and four details.
 * Evenly spaced, so shares are exact: surface 80 % asfalt / 20 % grus;
 * one bridge; road class 50/50; speed 60 % 30 km/t, 40 % unknown.
 */
const DETAILED_COORDINATES = Array.from({ length: 11 }, (_, i) => [10.7522 - i * 0.0022, 59.9139]);

export const MOCK_ROUTE_DETAILED = {
  routes: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: DETAILED_COORDINATES },
      properties: {
        distance: 1226,
        time: 300000,
        instructions: PRIMARY_INSTRUCTIONS,
        primary: true,
        route_index: 0,
        style: 'solid',
        elevation: [20, 22, 25, 27, 30, 32, 35, 33, 36, 40, 41],
        ascend: 23,
        descend: 2,
        details: {
          surface: [[0, 6, 'asphalt'], [6, 8, 'gravel'], [8, 10, 'asphalt']],
          road_environment: [[0, 3, 'road'], [3, 4, 'bridge'], [4, 10, 'road']],
          road_class: [[0, 5, 'cycleway'], [5, 10, 'residential']],
          max_speed: [[0, 4, null], [4, 10, 30]]
        }
      }
    }
  ],
  dashed_segments: []
};

/** What the self-hosted GraphHopper gives today: no heights, no surface. */
export const MOCK_ROUTE_ROAD_ONLY = {
  routes: [
    {
      ...MOCK_ROUTE_DETAILED.routes[0],
      properties: {
        distance: 1226,
        time: 300000,
        instructions: PRIMARY_INSTRUCTIONS,
        primary: true,
        route_index: 0,
        style: 'solid',
        details: {
          road_environment: [[0, 3, 'road'], [3, 4, 'bridge'], [4, 10, 'road']],
          road_class: [[0, 5, 'cycleway'], [5, 10, 'residential']],
          max_speed: [[0, 4, null], [4, 10, 30]]
        }
      }
    }
  ],
  dashed_segments: []
};

/** All-services-healthy /health payload. */
export const MOCK_HEALTH = {
  status: 'healthy',
  services: {
    tileserver: { status: 'healthy', status_code: 200 },
    nominatim: { status: 'healthy', status_code: 200 },
    graphhopper: { status: 'healthy', status_code: 200 },
    overpass: { status: 'healthy', status_code: 200 },
    frontend: { status: 'healthy', status_code: 200 }
  }
};

/** Empty streetview panorama collection (we don't exercise the panorama UI). */
export const MOCK_STREETVIEW_PANORAMAS = {
  type: 'FeatureCollection',
  features: []
};

/** Empty Overpass result collection. */
export const MOCK_OVERPASS = {
  type: 'FeatureCollection',
  features: []
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });

export interface MockOptions {
  /**
   * When true, /route returns the multi-route payload (primary + alternative).
   * Defaults to false (single route). Tests can override per-route at runtime
   * via the request-driven branch below (alternatives=true also triggers it).
   */
  multiRoute?: boolean;
}

/**
 * Install all network mocks on a page. Call before navigating.
 *
 * Routes are registered most-specific-first; Playwright matches the LAST
 * registered handler first, so the broad tile/catch-all handlers are added
 * first and the specific API handlers afterwards.
 */
export async function setupMocks(page: Page, options: MockOptions = {}): Promise<void> {
  const { multiRoute = false } = options;

  // --- Broad fallbacks (registered first = lowest precedence) ---------------

  // Vector tiles (.pbf / .mvt) -> empty body.
  await page.route(/\.(pbf|mvt)(\?.*)?$/i, (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: '' })
  );

  // Raster tiles (.png / .jpg / .jpeg) -> 1x1 transparent PNG.
  await page.route(/\.(png|jpe?g)(\?.*)?$/i, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG })
  );

  // XYZ tile templates that have no file extension (e.g. ArcGIS .../tile/{z}/{y}/{x}).
  await page.route(/\/(tiles?|tile)\//i, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG })
  );

  // --- Runtime config -------------------------------------------------------
  await page.route(/config(_dev)?\.json(\?.*)?$/i, (route) => json(route, MOCK_CONFIG));

  // --- Backend API ----------------------------------------------------------
  await page.route(/\/api\/health(\?.*)?$/, (route) => json(route, MOCK_HEALTH));
  await page.route(/\/api\/search(\?.*)?$/, (route) => json(route, MOCK_SEARCH));
  await page.route(/\/api\/reverse(\?.*)?$/, (route) => json(route, MOCK_REVERSE));
  await page.route(/\/api\/overpass(\?.*)?$/, (route) => json(route, MOCK_OVERPASS));

  // /route — return multi-route when explicitly enabled OR when the request
  // asks for alternatives, so the alternatives UI can be exercised regardless
  // of how the spec opts in.
  await page.route(/\/api\/route(\?.*)?$/, (route: Route, request: Request) => {
    const wantsAlternatives = request.url().includes('alternatives=true');
    const body = multiRoute || wantsAlternatives ? MOCK_ROUTE_MULTI : MOCK_ROUTE_SINGLE;
    return json(route, body);
  });

  // --- Streetview -----------------------------------------------------------
  await page.route(/\/streetview\/api\/panoramas(\?.*)?$/, (route) =>
    json(route, MOCK_STREETVIEW_PANORAMAS)
  );
  await page.route(/\/streetview\/metadata\//, (route) => json(route, { heading: 0 }));
  await page.route(/\/streetview\/panorama\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG })
  );
}
