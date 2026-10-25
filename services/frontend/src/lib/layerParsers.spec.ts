import { describe, it, expect } from 'vitest';
import { parseCSVLine, parseCSV, parseKML, parseGPX, parseGeoJsonUpload } from './layerParsers';

describe('parseCSVLine', () => {
  it('splits a plain comma-separated line and trims fields', () => {
    expect(parseCSVLine('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside double-quoted fields', () => {
    expect(parseCSVLine('"Oslo, Norway",59.9')).toEqual(['Oslo, Norway', '59.9']);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCSVLine('"she said ""hi""",b')).toEqual(['she said "hi"', 'b']);
  });
});

describe('parseCSV', () => {
  const csv = 'name,lat,lon\nOslo,59.9,10.7\nBergen,60.4,5.3';

  it('builds Point features with [lng, lat] coordinates and extra columns as properties', () => {
    const fc = parseCSV(csv, 'lat', 'lon');
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [10.7, 59.9] });
    expect(fc.features[0].properties).toEqual({ name: 'Oslo' });
  });

  it('matches column names case-insensitively', () => {
    const fc = parseCSV('NAME,LAT,LON\nX,1,2', 'lat', 'lon');
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
  });

  it('skips rows with non-numeric coordinates', () => {
    const fc = parseCSV('lat,lon\n1,2\nbad,2\n3,4', 'lat', 'lon');
    expect(fc.features).toHaveLength(2);
  });

  it('strips a UTF-8 BOM and handles CRLF line endings', () => {
    const fc = parseCSV('\uFEFF' + 'lat,lon\r\n1,2\r\n', 'lat', 'lon');
    expect(fc.features).toHaveLength(1);
  });

  it('throws when there is no data row', () => {
    expect(() => parseCSV('lat,lon', 'lat', 'lon')).toThrow();
  });

  it('throws when the requested columns are missing', () => {
    expect(() => parseCSV('a,b\n1,2', 'lat', 'lon')).toThrow();
  });
});

describe('parseKML', () => {
  const kml = `<?xml version="1.0"?>
    <kml><Document>
      <Placemark><name>P1</name><description>d1</description>
        <Point><coordinates>10,60</coordinates></Point></Placemark>
      <Placemark><name>L1</name>
        <LineString><coordinates>10,60 11,61</coordinates></LineString></Placemark>
      <Placemark><name>Poly</name>
        <Polygon><outerBoundaryIs><LinearRing>
          <coordinates>10,60 11,61 12,62 10,60</coordinates>
        </LinearRing></outerBoundaryIs></Polygon></Placemark>
    </Document></kml>`;

  it('parses Point, LineString and Polygon placemarks', () => {
    const fc = parseKML(kml);
    expect(fc.features).toHaveLength(3);

    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [10, 60] });
    expect(fc.features[0].properties).toEqual({ name: 'P1', description: 'd1' });

    expect(fc.features[1].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [10, 60],
        [11, 61]
      ]
    });

    expect(fc.features[2].geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [10, 60],
          [11, 61],
          [12, 62],
          [10, 60]
        ]
      ]
    });
  });

  it('drops a LineString with fewer than two valid coordinates', () => {
    const fc = parseKML(
      '<kml><Placemark><LineString><coordinates>10,60</coordinates></LineString></Placemark></kml>'
    );
    expect(fc.features).toHaveLength(0);
  });
});

describe('parseGPX', () => {
  const gpx = `<?xml version="1.0"?>
    <gpx>
      <wpt lat="59.9" lon="10.7"><name>W1</name><desc>dd</desc></wpt>
      <trk><name>T1</name><trkseg>
        <trkpt lat="59.9" lon="10.7"></trkpt>
        <trkpt lat="60.0" lon="10.8"></trkpt>
      </trkseg></trk>
      <rte><name>R1</name>
        <rtept lat="1" lon="2"></rtept>
        <rtept lat="3" lon="4"></rtept>
      </rte>
    </gpx>`;

  it('parses waypoints, tracks and routes', () => {
    const fc = parseGPX(gpx);
    expect(fc.features).toHaveLength(3);

    const wpt = fc.features.find((f) => f.properties?.type === 'waypoint');
    expect(wpt?.geometry).toEqual({ type: 'Point', coordinates: [10.7, 59.9] });
    expect(wpt?.properties).toEqual({ name: 'W1', description: 'dd', type: 'waypoint' });

    const trk = fc.features.find((f) => f.properties?.type === 'track');
    expect(trk?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [10.7, 59.9],
        [10.8, 60.0]
      ]
    });

    const rte = fc.features.find((f) => f.properties?.type === 'route');
    expect(rte?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [2, 1],
        [4, 3]
      ]
    });
  });

  it('skips a track segment with fewer than two valid points', () => {
    const fc = parseGPX(
      '<gpx><trk><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>'
    );
    expect(fc.features).toHaveLength(0);
  });
});

describe('parseGeoJsonUpload', () => {
  it('accepts a FeatureCollection as-is', () => {
    const fc = parseGeoJsonUpload(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 59] }, properties: {} }]
      })
    );
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
  });

  it('wraps a single Feature in a FeatureCollection', () => {
    const fc = parseGeoJsonUpload(
      JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 59] }, properties: { a: 1 } })
    );
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toEqual({ a: 1 });
  });

  it('wraps a bare Geometry in a Feature', () => {
    const fc = parseGeoJsonUpload(JSON.stringify({ type: 'LineString', coordinates: [[10, 59], [11, 60]] }));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[10, 59], [11, 60]] });
  });

  it('drops features whose geometry type is not GeoJSON', () => {
    const fc = parseGeoJsonUpload(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Blob', coordinates: [] }, properties: {} },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }
        ]
      })
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry?.type).toBe('Point');
  });

  it('rejects JSON that is not GeoJSON with a Norwegian message', () => {
    expect(() => parseGeoJsonUpload(JSON.stringify({ foo: 1 }))).toThrow(
      'Filen inneholder ikke gyldig GeoJSON'
    );
    expect(() => parseGeoJsonUpload('[]')).toThrow('Filen inneholder ikke gyldig GeoJSON');
  });

  it('rejects a FeatureCollection with no valid features', () => {
    expect(() =>
      parseGeoJsonUpload(JSON.stringify({ type: 'FeatureCollection', features: [] }))
    ).toThrow('Filen inneholder ingen kartobjekter');
  });

  it('rejects invalid JSON with a Norwegian message', () => {
    expect(() => parseGeoJsonUpload('{not json')).toThrow('Kunne ikke lese filen som JSON');
  });
});
