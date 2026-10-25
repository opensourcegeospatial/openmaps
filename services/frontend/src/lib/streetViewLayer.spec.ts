import { describe, it, expect } from 'vitest';
import {
  isStreetViewConfigured,
  shouldLoadStreetViewPoints,
  STREETVIEW_DEFAULT_MIN_ZOOM,
  streetViewCoverage
} from './streetViewLayer';

const view = { west: 10.7, south: 59.9, east: 10.8, north: 60.0 };

describe('shouldLoadStreetViewPoints', () => {
  it('skips loading below the configured minimum zoom', () => {
    expect(shouldLoadStreetViewPoints(12, view, { enabled: true, minZoom: 14 })).toBe(false);
    expect(shouldLoadStreetViewPoints(14, view, { enabled: true, minZoom: 14 })).toBe(true);
  });

  it('applies a sane default minimum zoom when none is configured', () => {
    expect(STREETVIEW_DEFAULT_MIN_ZOOM).toBeGreaterThanOrEqual(13);
    expect(shouldLoadStreetViewPoints(STREETVIEW_DEFAULT_MIN_ZOOM - 1, view, { enabled: true })).toBe(false);
    expect(shouldLoadStreetViewPoints(STREETVIEW_DEFAULT_MIN_ZOOM, view, { enabled: true })).toBe(true);
  });

  it('skips loading when the view does not intersect the configured coverage bounds', () => {
    const config = { enabled: true, minZoom: 10, bounds: [5.0, 58.0, 6.0, 59.0] as [number, number, number, number] };
    expect(shouldLoadStreetViewPoints(15, view, config)).toBe(false);
    expect(
      shouldLoadStreetViewPoints(15, { west: 5.5, south: 58.5, east: 5.6, north: 58.6 }, config)
    ).toBe(true);
  });
});

describe('streetViewCoverage', () => {
  const view = { west: 10.7, south: 59.9, east: 10.8, north: 59.95 };
  it('names why a view shows no points', () => {
    expect(streetViewCoverage(12, view, {})).toBe('zoom-in');
    expect(streetViewCoverage(19, view, { maxZoom: 18 })).toBe('zoom-out');
    expect(streetViewCoverage(15, view, { bounds: [5, 60, 6, 61] })).toBe('outside');
    expect(streetViewCoverage(15, view, { bounds: [10, 59, 11, 60] })).toBe('ok');
  });
});

describe('isStreetViewConfigured', () => {
  const full = {
    enabled: true,
    tilesUrl: 'https://tiles/{z}/{x}/{y}.png',
    panoramaUrl: 'https://pano/{id}'
  };

  it('needs enabling, somewhere to read points from, and a panorama url', () => {
    expect(isStreetViewConfigured(full)).toBe(true);
    expect(isStreetViewConfigured({ ...full, enabled: false })).toBe(false);
    expect(isStreetViewConfigured({ ...full, tilesUrl: undefined })).toBe(false);
    expect(isStreetViewConfigured({ ...full, panoramaUrl: undefined })).toBe(false);
  });

  it('accepts GeoJSON points instead of tiles', () => {
    expect(
      isStreetViewConfigured({
        enabled: true,
        geoJsonUrl: 'https://points.json',
        panoramaUrl: 'https://pano/{id}'
      })
    ).toBe(true);
  });

  it('treats a missing configuration as not configured', () => {
    expect(isStreetViewConfigured(undefined)).toBe(false);
    expect(isStreetViewConfigured(null)).toBe(false);
  });
});
