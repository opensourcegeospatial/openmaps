import { describe, it, expect } from 'vitest';
import L from 'leaflet';
import { effectiveLayerOpacity, applyVectorLayerOpacity } from './layerOpacity';

describe('effectiveLayerOpacity', () => {
  it('multiplies the service-level and sub-layer opacities', () => {
    expect(effectiveLayerOpacity(0.5, 0.5)).toBe(0.25);
    expect(effectiveLayerOpacity(1, 0.3)).toBe(0.3);
  });

  it('treats a missing service-level opacity as fully opaque and clamps to [0,1]', () => {
    expect(effectiveLayerOpacity(undefined, 0.7)).toBe(0.7);
    expect(effectiveLayerOpacity(2, 0.7)).toBe(0.7);
    expect(effectiveLayerOpacity(1, -1)).toBe(0);
  });
});

describe('applyVectorLayerOpacity', () => {
  const layer = L.geoJSON({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 59] }, properties: {} },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[10, 59], [11, 59], [11, 60], [10, 59]]] },
        properties: {}
      }
    ]
  }, { pointToLayer: (_f, latlng) => L.circleMarker(latlng) });

  it('updates stroke and fill opacity of every sub-layer (points fill stronger than areas)', () => {
    applyVectorLayerOpacity(layer, 0.4);
    const [point, polygon] = layer.getLayers() as [L.CircleMarker, L.Polygon];
    expect(point.options.opacity).toBe(0.4);
    expect(point.options.fillOpacity).toBeCloseTo(0.2);
    expect(polygon.options.opacity).toBe(0.4);
    expect(polygon.options.fillOpacity).toBeCloseTo(0.12);
  });
});
