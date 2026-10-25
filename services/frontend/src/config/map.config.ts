import type { MapStyle } from '../lib/mapStyles';
import type { ThemeColors } from '../lib/mapColors';

export interface StreetViewConfig {
  enabled: boolean;
  tilesUrl?: string;
  geoJsonUrl?: string;
  panoramaUrl?: string;
  metadataUrl?: string;
  sourceLayer?: string;
  minZoom?: number;
  maxZoom?: number;
  circleColor?: string;
  circleRadius?: number;
  circleStrokeColor?: string;
  circleStrokeWidth?: number;
  circleOpacity?: number;
  bounds?: [number, number, number, number];
}

export interface MapConfig {
  defaultZoom: number;
  defaultCenter: { lng: number; lat: number };
  styles: MapStyle[];
  apiEndpoints: {
    graphhopper: string;
    nominatim: {
      search: string;
      reverse: string;
    };
    overpass: string;
  };
  streetview?: StreetViewConfig;
  /** Optional color theme overrides applied to map geometry + UI accent. */
  theme?: ThemeColors;
  /** Whether the system-health dashboard toggle button is shown (default true). */
  healthDashboardEnabled: boolean;
}

export type { ThemeColors };

const CONFIG_LOCATIONS = [
  '/config.json',
  '/static/config.json',
  '/client/config.json',
  '/config_dev.json',
  '/static/config_dev.json',
  '/client/config_dev.json'
];

const defaultApiEndpoints = {
  graphhopper: '/api/route',
  nominatim: {
    search: '/api/search',
    reverse: '/api/reverse'
  },
  overpass: '/api/overpass'
};

/**
 * The one default map view (Oslo). The runtime config, the entrypoint's
 * MAP_DEFAULT_* fallbacks and static/config.json all agree on it; this is the
 * copy the app itself falls back to when a config is missing or incomplete.
 */
export const DEFAULT_MAP_ZOOM = 12;
export const DEFAULT_MAP_CENTER: { lng: number; lat: number } = { lng: 10.7446, lat: 59.9127 };

const serverFallbackConfig: MapConfig = {
  defaultZoom: DEFAULT_MAP_ZOOM,
  defaultCenter: { ...DEFAULT_MAP_CENTER },
  styles: [],
  apiEndpoints: defaultApiEndpoints,
  streetview: undefined,
  healthDashboardEnabled: true
};

const clientFallbackConfig: MapConfig = {
  defaultZoom: DEFAULT_MAP_ZOOM,
  defaultCenter: { ...DEFAULT_MAP_CENTER },
  styles: [],
  apiEndpoints: defaultApiEndpoints,
  streetview: undefined,
  healthDashboardEnabled: true
};

let cachedConfig: MapConfig | null = null;
let pendingConfigPromise: Promise<MapConfig> | null = null;

function normalizeStreetview(input: unknown): StreetViewConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const raw = input as Record<string, unknown>;
  const enabledValue = raw.enabled;
  const tilesUrl = typeof raw.tilesUrl === 'string' ? raw.tilesUrl : undefined;
  const geoJsonUrl = typeof raw.geoJsonUrl === 'string' ? raw.geoJsonUrl : undefined;
  const panoramaUrl = typeof raw.panoramaUrl === 'string' ? raw.panoramaUrl : undefined;
  const boundsValue = Array.isArray(raw.bounds) ? raw.bounds : undefined;
  const bounds = Array.isArray(boundsValue) && boundsValue.length === 4 && boundsValue.every((value) => typeof value === 'number')
    ? (boundsValue as [number, number, number, number])
    : undefined;

  const enabled =
    typeof enabledValue === 'boolean'
      ? enabledValue
      : Boolean((tilesUrl || geoJsonUrl) && panoramaUrl);

  return {
    enabled,
    tilesUrl,
    geoJsonUrl,
    panoramaUrl,
    metadataUrl: typeof raw.metadataUrl === 'string' ? raw.metadataUrl : undefined,
    sourceLayer: typeof raw.sourceLayer === 'string' ? raw.sourceLayer : undefined,
    minZoom: typeof raw.minZoom === 'number' ? raw.minZoom : undefined,
    maxZoom: typeof raw.maxZoom === 'number' ? raw.maxZoom : undefined,
    circleColor: typeof raw.circleColor === 'string' ? raw.circleColor : undefined,
    circleRadius: typeof raw.circleRadius === 'number' ? raw.circleRadius : undefined,
    circleStrokeColor: typeof raw.circleStrokeColor === 'string' ? raw.circleStrokeColor : undefined,
    circleStrokeWidth:
      typeof raw.circleStrokeWidth === 'number' ? raw.circleStrokeWidth : undefined,
    circleOpacity: typeof raw.circleOpacity === 'number' ? raw.circleOpacity : undefined,
    bounds
  };
}

// Recognized theme keys; everything else in json.theme is ignored.
const THEME_KEYS = [
  'primary',
  'neutral',
  'surface',
  'background',
  'text',
  'border',
  'success',
  'danger',
  'warning',
  'routePrimary',
  'routeAlternative',
  'markerFrom',
  'markerTo',
  'markerWaypoint',
  'avoid',
  'featureSelected'
] as const;

function normalizeTheme(input: unknown): ThemeColors | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const raw = input as Record<string, unknown>;
  const theme: ThemeColors = {};
  // All theme values are colors; only honor 6-digit hex (#rrggbb) so a bad
  // value (hand-edited config, typo) can never inject invalid CSS.
  const HEX6 = /^#[0-9a-fA-F]{6}$/;
  for (const key of THEME_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && HEX6.test(value)) {
      theme[key] = value;
    }
  }

  return Object.keys(theme).length > 0 ? theme : undefined;
}

async function fetchConfigFromServer(): Promise<MapConfig> {
  if (typeof window === 'undefined') {
    return serverFallbackConfig;
  }

  try {
    let res: Response | null = null;
    for (const location of CONFIG_LOCATIONS) {
      if (import.meta.env.DEV) console.log(`[config] Attempting to load config from ${location}`);
      try {
        const tempRes = await fetch(location, { cache: 'no-cache' });
        if (import.meta.env.DEV) console.log(`[config] Fetch response status for ${location}:`, tempRes.status);
        if (tempRes.ok) {
          res = tempRes;
          if (import.meta.env.DEV) console.log(`[config] Successfully loaded config from ${location}`);
          break;
        }
      } catch (fetchErr) {
        console.warn(`[config] Failed to fetch from ${location}:`, fetchErr);
      }
    }

    if (!res) {
      console.warn('[config] Could not fetch config.json from any location, using defaults');
      return clientFallbackConfig;
    }

    try {
      const text = await res.text();
      if (import.meta.env.DEV) console.log('[config] Raw config content:', text);
      const json = JSON.parse(text);
      if (import.meta.env.DEV) console.log('[config] Parsed JSON successfully:', json);

      return {
        defaultZoom: typeof json.defaultZoom === 'number' ? json.defaultZoom : DEFAULT_MAP_ZOOM,
        defaultCenter:
          json.defaultCenter && typeof json.defaultCenter.lng === 'number' && typeof json.defaultCenter.lat === 'number'
            ? json.defaultCenter
            : { ...DEFAULT_MAP_CENTER },
        styles: Array.isArray(json.styles) ? json.styles : [],
        apiEndpoints: json.apiEndpoints || defaultApiEndpoints,
        streetview: normalizeStreetview(json.streetview),
        theme: normalizeTheme(json.theme),
        healthDashboardEnabled:
          typeof json.healthDashboardEnabled === 'boolean' ? json.healthDashboardEnabled : true
      };
    } catch (parseErr) {
      console.error('[config] Failed to parse JSON:', parseErr);
      return clientFallbackConfig;
    }
  } catch (err) {
    console.error('[config] Error loading /config.json', err);
    return clientFallbackConfig;
  }
}

export async function loadMapConfig(forceReload = false): Promise<MapConfig> {
  if (!forceReload) {
    if (cachedConfig) {
      return cachedConfig;
    }
    if (pendingConfigPromise) {
      return pendingConfigPromise;
    }
  }

  const fetchPromise = fetchConfigFromServer()
    .then((config) => {
      cachedConfig = config;
      return config;
    })
    .finally(() => {
      if (pendingConfigPromise === fetchPromise) {
        pendingConfigPromise = null;
      }
    });

  pendingConfigPromise = fetchPromise;
  return fetchPromise;
}


