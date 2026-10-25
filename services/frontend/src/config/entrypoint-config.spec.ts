/**
 * Config propagation tests for the frontend entrypoint.
 *
 * These tests verify that the Node.js config generation logic (extracted from
 * docker-entrypoint.sh into scripts/generate-config.cjs) correctly translates
 * environment variables into config.json fields.
 *
 * Two approaches are used:
 * 1. Direct: import buildConfig and call it with a mock env object.
 * 2. Integration: spawn `node scripts/generate-config.cjs` with real env vars
 *    and parse the stdout JSON.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

// Use createRequire to load the CJS module from ESM context
const require = createRequire(import.meta.url);
const { buildConfig } = require('../../scripts/generate-config.cjs');

const SCRIPT_PATH = resolve(__dirname, '../../scripts/generate-config.cjs');

/** Helper: run the script with given env vars and return parsed JSON. */
function runScript(env: Record<string, string>): Record<string, unknown> {
  // Don't pass OUT so the script writes to stdout
  const stdout = execFileSync('node', [SCRIPT_PATH], {
    env: { ...env, PATH: process.env.PATH },
    encoding: 'utf-8',
    timeout: 5000,
  });
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// Direct unit tests (buildConfig)
// ---------------------------------------------------------------------------
describe('buildConfig (direct)', () => {
  it('MAP_DEFAULT_ZOOM=5 results in config with zoom: 5', () => {
    const config = buildConfig({ MAP_DEFAULT_ZOOM: '5' });
    expect(config.defaultZoom).toBe(5);
  });

  it('MAP_DEFAULT_LNG=15.0 and MAP_DEFAULT_LAT=60.0 result in correct lng/lat', () => {
    const config = buildConfig({
      MAP_DEFAULT_LNG: '15.0',
      MAP_DEFAULT_LAT: '60.0',
    });
    expect(config.defaultCenter.lng).toBe(15);
    expect(config.defaultCenter.lat).toBe(60);
  });

  it('API URL env vars propagate to config apiEndpoints', () => {
    const config = buildConfig({
      API_GRAPHHOPPER_URL: 'http://graphhopper:8989/route',
      API_NOMINATIM_SEARCH_URL: 'http://nominatim:8080/search',
      API_NOMINATIM_REVERSE_URL: 'http://nominatim:8080/reverse',
      API_OVERPASS_URL: 'http://overpass:80/api/interpreter',
    });
    expect(config.apiEndpoints.graphhopper).toBe('http://graphhopper:8989/route');
    expect(config.apiEndpoints.nominatim.search).toBe('http://nominatim:8080/search');
    expect(config.apiEndpoints.nominatim.reverse).toBe('http://nominatim:8080/reverse');
    expect(config.apiEndpoints.overpass).toBe('http://overpass:80/api/interpreter');
  });

  it('defaults the map to Oslo at zoom 12 when MAP_DEFAULT_* are unset', () => {
    const config = buildConfig({});
    expect(config.defaultZoom).toBe(12);
    expect(config.defaultCenter).toEqual({ lng: 10.7446, lat: 59.9127 });
  });

  it('keeps a MAP_DEFAULT_* value of 0 instead of falling back to Oslo', () => {
    const config = buildConfig({
      MAP_DEFAULT_ZOOM: '0',
      MAP_DEFAULT_LNG: '0',
      MAP_DEFAULT_LAT: '0',
    });
    expect(config.defaultZoom).toBe(0);
    expect(config.defaultCenter).toEqual({ lng: 0, lat: 0 });
  });

  it('falls back to Oslo for empty or non-numeric MAP_DEFAULT_* values', () => {
    const config = buildConfig({
      MAP_DEFAULT_ZOOM: '',
      MAP_DEFAULT_LNG: 'abc',
      MAP_DEFAULT_LAT: '   ',
    });
    expect(config.defaultZoom).toBe(12);
    expect(config.defaultCenter).toEqual({ lng: 10.7446, lat: 59.9127 });
  });

  it('uses default values when env vars are not set', () => {
    const config = buildConfig({});
    // API endpoints default to relative /api/* paths (served by the frontend
    // nginx proxy) so a remote browser hits its own origin — no CORS.
    expect(config.apiEndpoints.graphhopper).toBe('/api/route');
    expect(config.apiEndpoints.nominatim.search).toBe('/api/search');
    expect(config.apiEndpoints.nominatim.reverse).toBe('/api/reverse');
    expect(config.apiEndpoints.overpass).toBe('/api/overpass');
  });

  it('partial env overrides only affect specified fields', () => {
    const config = buildConfig({
      MAP_DEFAULT_ZOOM: '10',
      API_GRAPHHOPPER_URL: 'http://custom:1234/route',
    });
    expect(config.defaultZoom).toBe(10);
    expect(config.apiEndpoints.graphhopper).toBe('http://custom:1234/route');
    // Unset fields use defaults
    expect(config.defaultCenter).toEqual({ lng: 10.7446, lat: 59.9127 });
    expect(config.apiEndpoints.nominatim.search).toBe('/api/search');
  });
});

// ---------------------------------------------------------------------------
// Street view enabled flag (FIX 2)
// ---------------------------------------------------------------------------
describe('streetview enabled flag', () => {
  it('STREETVIEW_ENABLED=false with URLs set keeps enabled=false', () => {
    const config = buildConfig({
      STREETVIEW_ENABLED: 'false',
      STREETVIEW_PANORAMA_URL: 'http://example/pano/{id}',
      STREETVIEW_TILES_URL: 'http://example/tiles/{z}/{x}/{y}',
    });
    // The streetview config object is still emitted (URLs present) ...
    expect(config.streetview).toBeDefined();
    expect(config.streetview.panoramaUrl).toBe('http://example/pano/{id}');
    expect(config.streetview.tilesUrl).toBe('http://example/tiles/{z}/{x}/{y}');
    // ... but the explicit false flag is respected.
    expect(config.streetview.enabled).toBe(false);
  });

  it('STREETVIEW_ENABLED=true sets enabled=true', () => {
    const config = buildConfig({
      STREETVIEW_ENABLED: 'true',
      STREETVIEW_PANORAMA_URL: 'http://example/pano/{id}',
    });
    expect(config.streetview.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Theme colors from env (FIX 7)
// ---------------------------------------------------------------------------
describe('theme colors', () => {
  it('omits config.theme when no THEME_* vars are set', () => {
    const config = buildConfig({});
    expect(config.theme).toBeUndefined();
  });

  it('emits only the THEME_* keys that are set', () => {
    const config = buildConfig({
      THEME_ROUTE_PRIMARY: '#123456',
      THEME_MARKER_FROM: '#00ff00',
    });
    expect(config.theme).toEqual({
      routePrimary: '#123456',
      markerFrom: '#00ff00',
    });
  });

  it('ignores empty/whitespace THEME_* values', () => {
    const config = buildConfig({
      THEME_PRIMARY: '',
      THEME_AVOID: '   ',
      THEME_FEATURE_SELECTED: '#abcdef',
    });
    expect(config.theme).toEqual({ featureSelected: '#abcdef' });
  });

  it('drops THEME_* values that are not valid 6-digit hex', () => {
    const config = buildConfig({
      THEME_PRIMARY: 'purple', // named color → dropped
      THEME_SURFACE: '#fff', // 3-digit shorthand → dropped
      THEME_DANGER: '#ff00ff', // valid → kept
      THEME_TEXT: '#1a1a1a', // valid → kept
    });
    expect(config.theme).toEqual({ danger: '#ff00ff', text: '#1a1a1a' });
  });

  it('maps the new single-hex UI knobs (neutral chrome + status)', () => {
    const config = buildConfig({
      THEME_PRIMARY: '#0a84ff',
      THEME_SURFACE: '#f4f4f5',
      THEME_BACKGROUND: '#fafafa',
      THEME_TEXT: '#1a1a1a',
      THEME_BORDER: '#d4d4d8',
      THEME_NEUTRAL: '#5f5f5f',
      THEME_SUCCESS: '#116e6b',
      THEME_DANGER: '#c83719',
      THEME_WARNING: '#b06f00',
    });
    expect(config.theme).toEqual({
      primary: '#0a84ff',
      surface: '#f4f4f5',
      background: '#fafafa',
      text: '#1a1a1a',
      border: '#d4d4d8',
      neutral: '#5f5f5f',
      success: '#116e6b',
      danger: '#c83719',
      warning: '#b06f00',
    });
  });
});

describe('health dashboard toggle', () => {
  it('defaults healthDashboardEnabled to true', () => {
    expect(buildConfig({}).healthDashboardEnabled).toBe(true);
  });

  it('honors HEALTH_DASHBOARD_ENABLED=false / =true', () => {
    expect(buildConfig({ HEALTH_DASHBOARD_ENABLED: 'false' }).healthDashboardEnabled).toBe(false);
    expect(buildConfig({ HEALTH_DASHBOARD_ENABLED: 'true' }).healthDashboardEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration tests (spawn the script)
// ---------------------------------------------------------------------------
describe('generate-config.cjs script (integration)', () => {
  it('MAP_DEFAULT_ZOOM=5 produces config.json with zoom: 5', () => {
    const config = runScript({ MAP_DEFAULT_ZOOM: '5' });
    expect(config.defaultZoom).toBe(5);
  });

  it('MAP_DEFAULT_LNG=15.0 and MAP_DEFAULT_LAT=60.0 produce correct center', () => {
    const config = runScript({
      MAP_DEFAULT_LNG: '15.0',
      MAP_DEFAULT_LAT: '60.0',
    });
    expect((config.defaultCenter as { lng: number; lat: number }).lng).toBe(15);
    expect((config.defaultCenter as { lng: number; lat: number }).lat).toBe(60);
  });

  it('API URL env vars propagate to config.json endpoints', () => {
    const config = runScript({
      API_GRAPHHOPPER_URL: 'http://graphhopper:8989/route',
      API_NOMINATIM_SEARCH_URL: 'http://nominatim:8080/search',
      API_NOMINATIM_REVERSE_URL: 'http://nominatim:8080/reverse',
      API_OVERPASS_URL: 'http://overpass:80/api/interpreter',
    });
    const endpoints = config.apiEndpoints as Record<string, unknown>;
    expect(endpoints.graphhopper).toBe('http://graphhopper:8989/route');
    expect((endpoints.nominatim as Record<string, string>).search).toBe(
      'http://nominatim:8080/search',
    );
    expect((endpoints.nominatim as Record<string, string>).reverse).toBe(
      'http://nominatim:8080/reverse',
    );
    expect(endpoints.overpass).toBe('http://overpass:80/api/interpreter');
  });

  it('defaults are used when no env vars are set', () => {
    const config = runScript({});
    expect(config.defaultZoom).toBe(12);
    expect((config.defaultCenter as { lng: number; lat: number }).lng).toBe(10.7446);
    expect((config.defaultCenter as { lng: number; lat: number }).lat).toBe(59.9127);
    const endpoints = config.apiEndpoints as Record<string, unknown>;
    expect(endpoints.graphhopper).toBe('/api/route');
  });

  it('STREETVIEW_ENABLED=false with URLs set produces enabled:false', () => {
    const config = runScript({
      STREETVIEW_ENABLED: 'false',
      STREETVIEW_PANORAMA_URL: 'x',
      STREETVIEW_TILES_URL: 'y',
    });
    const sv = config.streetview as Record<string, unknown>;
    expect(sv).toBeDefined();
    expect(sv.enabled).toBe(false);
  });

  it('THEME_ROUTE_PRIMARY produces config.theme.routePrimary', () => {
    const config = runScript({ THEME_ROUTE_PRIMARY: '#123456' });
    expect((config.theme as Record<string, string>).routePrimary).toBe('#123456');
  });
});
