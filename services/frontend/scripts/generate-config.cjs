/**
 * Config generation logic extracted from docker-entrypoint.sh.
 *
 * When run directly (`node scripts/generate-config.cjs`), it reads env vars and
 * writes config.json to the path specified by the OUT env var (or stdout if
 * OUT is not set). This allows both the entrypoint and tests to use the same
 * logic.
 *
 * When required as a module, it exports { buildConfig } for direct testing.
 */

'use strict';

function parseStyles(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (_e) {
    return [];
  }
}

function parseNumber(value) {
  if (value == null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

// The one default map view (Oslo), used when MAP_DEFAULT_* is unset or not a
// number. docker-entrypoint.sh and static/config.json carry the same values.
const DEFAULT_ZOOM = 12;
const DEFAULT_LNG = 10.7446;
const DEFAULT_LAT = 59.9127;

/** A number from the environment, or `fallback` when it is empty or not numeric. A value of 0 is kept. */
function numberOr(value, fallback) {
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const numeric = parseNumber(value);
  return numeric === undefined ? fallback : numeric;
}

function parseBounds(raw) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ) {
      return parsed;
    }
  } catch (_err) {
    // ignore
  }
  return undefined;
}

function parseBoolean(value, fallback) {
  if (fallback === undefined) fallback = false;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return fallback;
}

/**
 * Build a theme object from THEME_* env vars. Only keys that are set and
 * non-empty are included. Returns undefined if no theme keys are present.
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, string>|undefined}
 */
function parseTheme(env) {
  const mapping = {
    primary: env.THEME_PRIMARY,
    neutral: env.THEME_NEUTRAL,
    surface: env.THEME_SURFACE,
    background: env.THEME_BACKGROUND,
    text: env.THEME_TEXT,
    border: env.THEME_BORDER,
    success: env.THEME_SUCCESS,
    danger: env.THEME_DANGER,
    warning: env.THEME_WARNING,
    routePrimary: env.THEME_ROUTE_PRIMARY,
    routeAlternative: env.THEME_ROUTE_ALTERNATIVE,
    markerFrom: env.THEME_MARKER_FROM,
    markerTo: env.THEME_MARKER_TO,
    markerWaypoint: env.THEME_MARKER_WAYPOINT,
    avoid: env.THEME_AVOID,
    featureSelected: env.THEME_FEATURE_SELECTED,
  };

  // All theme values are colors; only accept 6-digit hex (#rrggbb) so a typo
  // can never inject invalid CSS. Anything else is dropped with a warning.
  const HEX6 = /^#[0-9a-fA-F]{6}$/;
  const theme = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const v = value.trim();
    if (HEX6.test(v)) {
      theme[key] = v;
    } else {
      console.warn(
        `[generate-config] Ignoring theme color "${key}": not a 6-digit hex (#rrggbb): ${value}`
      );
    }
  }

  return Object.keys(theme).length > 0 ? theme : undefined;
}

/**
 * Build the runtime config object from the provided environment variables.
 * @param {Record<string, string|undefined>} env
 * @returns {object} The config object to be serialised as config.json.
 */
function buildConfig(env) {
  const config = {
    defaultZoom: numberOr(env.MAP_DEFAULT_ZOOM, DEFAULT_ZOOM),
    defaultCenter: {
      lng: numberOr(env.MAP_DEFAULT_LNG, DEFAULT_LNG),
      lat: numberOr(env.MAP_DEFAULT_LAT, DEFAULT_LAT),
    },
    styles: parseStyles(env.MAP_STYLES || '[]'),
    apiEndpoints: {
      graphhopper: env.API_GRAPHHOPPER_URL || '/api/route',
      nominatim: {
        search: env.API_NOMINATIM_SEARCH_URL || '/api/search',
        reverse: env.API_NOMINATIM_REVERSE_URL || '/api/reverse',
      },
      overpass: env.API_OVERPASS_URL || '/api/overpass',
    },
  };

  const streetViewEnabled = parseBoolean(env.STREETVIEW_ENABLED, false);
  const hasStreetViewUrlPair = Boolean((env.STREETVIEW_TILES_URL || env.STREETVIEW_GEOJSON_URL) && env.STREETVIEW_PANORAMA_URL);
  const hasStreetViewConfig = streetViewEnabled || hasStreetViewUrlPair;

  if (hasStreetViewConfig) {
    const bounds = parseBounds(env.STREETVIEW_BOUNDS);
    config.streetview = {
      enabled: streetViewEnabled,
      tilesUrl: env.STREETVIEW_TILES_URL || undefined,
      geoJsonUrl: env.STREETVIEW_GEOJSON_URL || undefined,
      panoramaUrl: env.STREETVIEW_PANORAMA_URL || undefined,
      metadataUrl: env.STREETVIEW_METADATA_URL || undefined,
      sourceLayer: env.STREETVIEW_SOURCE_LAYER || undefined,
      minZoom: parseNumber(env.STREETVIEW_MIN_ZOOM),
      maxZoom: parseNumber(env.STREETVIEW_MAX_ZOOM),
      circleColor: env.STREETVIEW_CIRCLE_COLOR || undefined,
      circleRadius: parseNumber(env.STREETVIEW_CIRCLE_RADIUS),
      circleStrokeColor: env.STREETVIEW_CIRCLE_STROKE_COLOR || undefined,
      circleStrokeWidth: parseNumber(env.STREETVIEW_CIRCLE_STROKE_WIDTH),
      circleOpacity: parseNumber(env.STREETVIEW_CIRCLE_OPACITY),
      bounds,
    };
  }

  // Health dashboard toggle button — on by default; set false to hide it.
  config.healthDashboardEnabled = parseBoolean(env.HEALTH_DASHBOARD_ENABLED, true);

  const theme = parseTheme(env);
  if (theme) {
    config.theme = theme;
  }

  return config;
}

// --- CLI mode: when run directly, write config.json to OUT or stdout ---
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');

  const outPath = process.env.OUT;
  const config = buildConfig(process.env);
  const json = JSON.stringify(config, null, 2);

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');

    // Copy to additional locations if WEBROOT is set
    const webroot = process.env.WEBROOT;
    if (webroot) {
      const locations = [
        outPath,
        `${webroot}/static/config.json`,
        `${webroot}/client/config.json`,
        `${webroot}/client/static/config.json`,
      ];
      locations.forEach((dest) => {
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(outPath, dest);
        } catch (_err) {
          // ignore copy failures
        }
      });
    }

    console.log('[entrypoint] Wrote config to', outPath);
    console.log('[entrypoint] Final config content (first 1k chars):');
    console.log(json.substring(0, 1000));
  } else {
    // No OUT — write to stdout (useful for testing)
    process.stdout.write(json);
  }
}

module.exports = { buildConfig, parseStyles, parseNumber, parseBounds, parseBoolean, parseTheme };
