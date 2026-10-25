import { describe, it, expect } from 'vitest';
import { readBbox, resolveFeatureView } from './featureView';
import type { GeoJSONFeature } from './nominatim';

const point = (lng: number, lat: number, bbox?: [number, number, number, number]): GeoJSONFeature => ({
  type: 'Feature',
  ...(bbox ? { bbox } : {}),
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: {}
});

describe('readBbox', () => {
  it('returns the four-number bbox and rejects anything else', () => {
    expect(readBbox(point(10.7, 59.9, [10, 59, 11, 60]))).toEqual([10, 59, 11, 60]);
    expect(readBbox(point(10.7, 59.9))).toBeNull();
    expect(
      readBbox({ ...point(10.7, 59.9), bbox: [10, 59, NaN, 60] as [number, number, number, number] })
    ).toBeNull();
  });
});

describe('resolveFeatureView', () => {
  it('zooms to a point that has no bbox or only a tiny one', () => {
    expect(resolveFeatureView(point(10.7, 59.9))).toEqual({ kind: 'point', lat: 59.9, lng: 10.7, zoom: 18 });
    expect(resolveFeatureView(point(10.7, 59.9, [10.7, 59.9, 10.7005, 59.9005]))).toEqual({
      kind: 'point',
      lat: 59.9,
      lng: 10.7,
      zoom: 18
    });
  });

  it('fits the bbox of a point that stands for an area, such as a stored city', () => {
    expect(resolveFeatureView(point(10.7, 59.9, [10.5, 59.8, 10.9, 60.0]))).toEqual({
      kind: 'bounds',
      bounds: [
        [59.8, 10.5],
        [60.0, 10.9]
      ]
    });
  });

  it('fits the bbox of any other geometry and gives up without one', () => {
    const polygon: GeoJSONFeature = {
      type: 'Feature',
      bbox: [10, 59, 11, 60],
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {}
    };
    expect(resolveFeatureView(polygon)).toEqual({
      kind: 'bounds',
      bounds: [
        [59, 10],
        [60, 11]
      ]
    });
    expect(resolveFeatureView({ ...polygon, bbox: undefined })).toBeNull();
  });

  it('gives up on a point with non-finite coordinates', () => {
    expect(resolveFeatureView(point(NaN, 59.9))).toBeNull();
  });
});
