import { describe, it, expect } from 'vitest';
import { sanitizeStoredLayers, serializeLayersForStorage } from './customLayers';

const validFile = {
  id: 'layer-1',
  type: 'file',
  fileType: 'geojson',
  name: 'points.geojson',
  data: {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 59] }, properties: {} }]
  },
  visible: true,
  opacity: 1,
  zIndex: 1
};

const validService = {
  id: 'layer-2',
  type: 'ogc-service',
  serviceType: 'wms',
  name: 'Kartverket',
  url: '/geoserver/wms',
  layers: [{ id: 'a', name: 'topo', title: 'Topo', enabled: true, opacity: 1 }],
  opacity: 1,
  zIndex: 2
};

const validXyz = {
  id: 'layer-3',
  type: 'xyz',
  name: 'Ortofoto',
  url: '/ortho/{z}/{x}/{y}.png',
  visible: true,
  opacity: 1,
  zIndex: 3
};

describe('sanitizeStoredLayers', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(sanitizeStoredLayers(null)).toEqual([]);
    expect(sanitizeStoredLayers('nope')).toEqual([]);
    expect(sanitizeStoredLayers({ id: 'x' })).toEqual([]);
  });

  it('keeps well-formed file, service and xyz layers', () => {
    const result = sanitizeStoredLayers([validFile, validService, validXyz]);
    expect(result.map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
  });

  it('drops a file layer whose data is not renderable GeoJSON', () => {
    const broken = { ...validFile, id: 'broken', data: { foo: 1 } };
    const result = sanitizeStoredLayers([broken, validXyz]);
    expect(result.map((l) => l.id)).toEqual(['layer-3']);
  });

  it('drops file layers whose features have unknown geometry types', () => {
    const broken = {
      ...validFile,
      id: 'broken',
      data: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Blob' }, properties: {} }]
      }
    };
    expect(sanitizeStoredLayers([broken])).toEqual([]);
  });

  it('drops entries without a string id or with an unknown type', () => {
    expect(sanitizeStoredLayers([{ ...validXyz, id: 42 }, { ...validXyz, type: 'magic' }])).toEqual([]);
  });

  it('drops a service without a layers array or url', () => {
    expect(sanitizeStoredLayers([{ ...validService, layers: 'x' }])).toEqual([]);
    expect(sanitizeStoredLayers([{ ...validService, url: 7 }])).toEqual([]);
  });

  it('drops an xyz layer without a url', () => {
    expect(sanitizeStoredLayers([{ ...validXyz, url: undefined }])).toEqual([]);
  });
});

describe('serializeLayersForStorage', () => {
  const smallFile = {
    id: 'small',
    type: 'file' as const,
    fileType: 'geojson' as const,
    name: 'small.geojson',
    data: { type: 'FeatureCollection', features: [] },
    visible: true,
    opacity: 1,
    zIndex: 1
  };
  const bigFile = {
    ...smallFile,
    id: 'big',
    name: 'big.geojson',
    data: {
      type: 'FeatureCollection',
      features: Array.from({ length: 200 }, (_, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i, i] },
        properties: { note: 'x'.repeat(50) }
      }))
    }
  };
  const xyz = { id: 'x', type: 'xyz' as const, name: 'Orto', url: '/o/{z}/{x}/{y}.png', visible: true, opacity: 1, zIndex: 2 };

  it('keeps every layer when all fit within the budget', () => {
    const { json, dropped } = serializeLayersForStorage([smallFile, xyz], 1_000_000);
    expect(dropped).toEqual([]);
    expect(JSON.parse(json).map((l: { id: string }) => l.id)).toEqual(['small', 'x']);
  });

  it('drops file layers whose payload alone exceeds the budget, keeping the rest', () => {
    const { json, dropped } = serializeLayersForStorage([bigFile, smallFile, xyz], 5_000);
    expect(dropped).toEqual([{ id: 'big', name: 'big.geojson' }]);
    expect(JSON.parse(json).map((l: { id: string }) => l.id)).toEqual(['small', 'x']);
  });

  it('never drops service or tile layers (they carry no payload)', () => {
    const { dropped } = serializeLayersForStorage([xyz], 10);
    expect(dropped).toEqual([]);
  });
});
