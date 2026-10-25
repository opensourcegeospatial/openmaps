import { describe, it, expect } from 'vitest';
import { buildFileVectorLayer } from './fileLayer';
import type { FileLayerConfig } from '../components/LayerManager';

const base: FileLayerConfig = {
  id: 'f1',
  type: 'file',
  fileType: 'geojson',
  name: 'x.geojson',
  data: null,
  visible: true,
  opacity: 1,
  zIndex: 1
};

describe('buildFileVectorLayer', () => {
  it('returns a Leaflet layer for renderable GeoJSON', () => {
    const layer = buildFileVectorLayer({
      ...base,
      data: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 59] }, properties: { a: 1 } }]
      }
    });
    expect(layer).not.toBeNull();
    expect(layer?.getLayers()).toHaveLength(1);
  });

  it('returns null instead of throwing for data Leaflet cannot draw', () => {
    const layer = buildFileVectorLayer({
      ...base,
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Blob' }, properties: {} }] }
    });
    expect(layer).toBeNull();
  });

  it('returns null for data that is not GeoJSON at all', () => {
    expect(buildFileVectorLayer({ ...base, data: { foo: 1 } })).toBeNull();
    expect(buildFileVectorLayer({ ...base, data: 'nope' })).toBeNull();
  });
});
