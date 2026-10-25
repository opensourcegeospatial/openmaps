import { describe, it, expect } from 'vitest';
import type { RouteResult } from './graphhopper';
import {
  crossings,
  detailShares,
  detailStretches,
  downsampleProfile,
  elevationProfile,
  EMPTY_HIGHLIGHT,
  heightAt,
  highlightGeometry,
  positionAt,
  routeDistances
} from './routeDetails';

// Eleven evenly spaced points along one parallel: every segment is the same
// length, so shares are exact tenths.
const coordinates = Array.from({ length: 11 }, (_, i) => [10.7522 - i * 0.0022, 59.9139]);

const route = (extra: Partial<RouteResult> = {}): RouteResult => ({
  geometry: { type: 'LineString', coordinates },
  distance: 1226,
  time: 300000,
  instructions: [],
  primary: true,
  routeIndex: 0,
  ...extra
});

describe('routeDistances', () => {
  it('accumulates metres along the route', () => {
    const d = routeDistances(route());
    expect(d).toHaveLength(11);
    expect(d[0]).toBe(0);
    expect(d[10]).toBeGreaterThan(1200);
    expect(d[10]).toBeLessThan(1250);
    expect(d[5]).toBeCloseTo(d[10] / 2, 3);
  });
});

describe('elevationProfile', () => {
  it('gives points, extremes, climb and descent', () => {
    const p = elevationProfile(route({ elevation: [20, 22, 25, 27, 30, 32, 35, 33, 36, 40, 41] }))!;
    expect(p.points).toHaveLength(11);
    expect(p.min).toBe(20);
    expect(p.max).toBe(41);
    expect(p.ascend).toBe(23);
    expect(p.descend).toBe(2);
    expect(p.length).toBeCloseTo(routeDistances(route())[10], 6);
  });

  it("prefers GraphHopper's own climb and descent", () => {
    const p = elevationProfile(route({ elevation: Array(11).fill(10), ascend: 64.3, descend: 25.1 }))!;
    expect(p.ascend).toBe(64.3);
    expect(p.descend).toBe(25.1);
  });

  it('is absent without heights', () => {
    expect(elevationProfile(route())).toBeNull();
  });

  it('interpolates the height at a distance', () => {
    const p = elevationProfile(route({ elevation: [0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] }))!;
    expect(heightAt(p, p.points[1].at / 2)).toBeCloseTo(5, 6);
  });
});

describe('detailShares', () => {
  it('measures each category by length, largest first, summing to 100', () => {
    const r = route({ details: { surface: [[0, 6, 'asphalt'], [6, 8, 'gravel'], [8, 10, 'asphalt']] } });
    expect(detailShares(r, 'surface').map(({ label, share }) => [label, share])).toEqual([
      ['Asfalt', 80],
      ['Grus', 20]
    ]);
  });

  it('keeps missing data as Ukjent and merges values it does not name into Annet', () => {
    const r = route({ details: { max_speed: [[0, 4, null], [4, 10, 30]] } });
    expect(detailShares(r, 'max_speed').map(({ label, share }) => [label, share])).toEqual([
      ['30 km/t', 60],
      ['Ukjent', 40]
    ]);
  });

  it('folds categories under 2 % into Annet, keeping their values for highlighting', () => {
    const many = Array.from({ length: 101 }, (_, i) => [10.7 - i * 0.0001, 59.9]);
    const r: RouteResult = {
      ...route(),
      geometry: { type: 'LineString', coordinates: many },
      details: { surface: [[0, 99, 'asphalt'], [99, 100, 'sand']] }
    };
    const shares = detailShares(r, 'surface');
    expect(shares.map((s) => s.label)).toEqual(['Asfalt', 'Annet']);
    expect(shares[1].values).toEqual(['sand']);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBe(100);
  });

  it('is empty when the detail is absent', () => {
    expect(detailShares(route(), 'surface')).toEqual([]);
  });

  it('groups null and GraphHopper\'s "missing" surface into one Ukjent share', () => {
    const r = route({ details: { surface: [[0, 5, null], [5, 10, 'missing']] } });
    expect(detailShares(r, 'surface').map(({ label, share }) => [label, share])).toEqual([['Ukjent', 100]]);
  });

  it("pointing at Annet highlights all its members", () => {
    // 101 evenly spaced points (100 segments): two small, non-adjacent
    // surfaces (each 1 %, so both fold below the 2 % threshold) separated by
    // a stretch of asphalt.
    const many = Array.from({ length: 101 }, (_, i) => [10.7 - i * 0.0001, 59.9]);
    const r: RouteResult = {
      ...route(),
      geometry: { type: 'LineString', coordinates: many },
      details: {
        surface: [
          [0, 97, 'asphalt'],
          [97, 98, 'sand'],
          [98, 99, 'asphalt'],
          [99, 100, 'wood']
        ]
      }
    };
    const shares = detailShares(r, 'surface');
    const annet = shares.find((s) => s.label === 'Annet');
    expect(annet?.values.slice().sort()).toEqual(['sand', 'wood']);
    const runs = detailStretches(r, 'surface', 'Annet');
    expect(runs).toHaveLength(2);
  });
});

describe('detailStretches', () => {
  it("returns the category's runs, joining adjacent intervals", () => {
    const r = route({
      details: { surface: [[0, 2, 'gravel'], [2, 4, 'gravel'], [4, 8, 'asphalt'], [8, 10, 'gravel']] }
    });
    const runs = detailStretches(r, 'surface', 'Grus');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(5); // points 0..4
    expect(runs[1]).toHaveLength(3); // points 8..10
    expect(runs[0][0]).toEqual([coordinates[0][0], coordinates[0][1]]);
  });
});

describe('crossings', () => {
  it('counts separate ferry, tunnel and bridge stretches', () => {
    const r = route({
      details: {
        road_environment: [[0, 2, 'road'], [2, 3, 'bridge'], [3, 4, 'bridge'], [4, 6, 'road'], [6, 7, 'tunnel'], [7, 10, 'ferry']]
      }
    });
    expect(crossings(r)).toEqual({ ferry: 1, tunnel: 1, bridge: 1 });
  });

  it('is absent without road_environment', () => {
    expect(crossings(route())).toBeNull();
  });
});

describe('positionAt', () => {
  it('interpolates position and height, clamped to the route', () => {
    const r = route({ elevation: [0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] });
    const half = routeDistances(r)[1] / 2;
    const at = positionAt(r, half)!;
    expect(at.lngLat[0]).toBeCloseTo((coordinates[0][0] + coordinates[1][0]) / 2, 8);
    expect(at.height).toBeCloseTo(5, 6);
    expect(positionAt(r, -50)!.lngLat).toEqual([coordinates[0][0], coordinates[0][1]]);
    const end = positionAt(r, 1e9)!.lngLat;
    expect(end[0]).toBeCloseTo(coordinates[10][0], 9);
    expect(end[1]).toBeCloseTo(coordinates[10][1], 9);
  });
});

describe('downsampleProfile', () => {
  it('keeps the ends and every bucket extreme', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ at: i, height: i === 500 ? 999 : 10 }));
    const out = downsampleProfile(points, 50);
    expect(out.length).toBeLessThanOrEqual(102);
    expect(out[0]).toBe(points[0]);
    expect(out[out.length - 1]).toBe(points[999]);
    expect(out.some((p) => p.height === 999)).toBe(true);
  });

  it('leaves a short profile alone', () => {
    const points = [{ at: 0, height: 1 }, { at: 1, height: 2 }];
    expect(downsampleProfile(points, 50)).toBe(points);
  });
});

describe('highlightGeometry', () => {
  const r = route({
    elevation: [20, 22, 25, 27, 30, 32, 35, 33, 36, 40, 41],
    details: { surface: [[0, 6, 'asphalt'], [6, 8, 'gravel'], [8, 10, 'asphalt']] }
  });

  it('is nothing for an empty highlight', () => {
    expect(highlightGeometry(r, EMPTY_HIGHLIGHT)).toBeNull();
  });

  it('shows the preview over the pinned category, and the position as a point', () => {
    const g = highlightGeometry(r, {
      position: 0,
      preview: { key: 'surface', id: 'Grus' },
      pinned: { key: 'surface', id: 'Asfalt' }
    })!;
    expect(g.point).toEqual([coordinates[0][0], coordinates[0][1]]);
    expect(g.stretches).toHaveLength(1);
    expect(g.stretches[0]).toHaveLength(3);
  });
});
