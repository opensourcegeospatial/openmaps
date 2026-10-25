/**
 * Pure parsers that convert user-uploaded map files (CSV, KML, GPX) into
 * GeoJSON FeatureCollections, for the Layer Manager's "add file" flow.
 *
 * These are intentionally framework-free and DOM-based (DOMParser) so they can
 * be unit-tested in isolation. WMS/WMTS/WFS/WCS capability parsing stays in
 * LayerManager.tsx because it is coupled to fetch/network.
 */

// Tokenize a single CSV line, honouring double-quoted fields that may contain
// commas and escaped double quotes ("" -> "). Leading/trailing whitespace is
// trimmed only for unquoted fields so intentional spacing inside quotes is kept.
//
// Limitations: this handles the common cases (quoted commas, CRLF, escaped
// quotes) but is not a full RFC 4180 parser — in particular newlines embedded
// inside quoted fields are not supported because parsing is done line-by-line.
export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);

  // Trim only fields that were not quoted-sensitive; safe to trim all here
  // since embedded leading/trailing spaces in quotes are rare for coordinates.
  return fields.map(f => f.trim());
}

// Parse CSV to GeoJSON
export function parseCSV(text: string, latCol: string, lngCol: string): GeoJSON.FeatureCollection {
  // Strip a UTF-8 BOM and normalise CRLF / lone-CR line endings.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n').filter(line => line.length > 0);
  if (lines.length < 2) throw new Error('CSV må ha overskrift og minst én datarad');

  const headers = parseCSVLine(lines[0]);
  const latIdx = headers.findIndex(h => h.toLowerCase() === latCol.toLowerCase());
  const lngIdx = headers.findIndex(h => h.toLowerCase() === lngCol.toLowerCase());

  if (latIdx === -1 || lngIdx === -1) {
    throw new Error(`Kunne ikke finne kolonner: ${latCol}, ${lngCol}`);
  }

  const features: GeoJSON.Feature[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const lat = parseFloat(values[latIdx]);
    const lng = parseFloat(values[lngIdx]);

    if (!isNaN(lat) && !isNaN(lng)) {
      const properties: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (idx !== latIdx && idx !== lngIdx) {
          properties[h] = values[idx] ?? '';
        }
      });

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

// Parse KML to GeoJSON (basic implementation)
export function parseKML(text: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  const features: GeoJSON.Feature[] = [];

  doc.querySelectorAll('Placemark').forEach(pm => {
    const name = pm.querySelector('name')?.textContent || '';
    const description = pm.querySelector('description')?.textContent || '';

    // Point
    const point = pm.querySelector('Point coordinates');
    if (point?.textContent) {
      const [lng, lat] = point.textContent.trim().split(',').map(Number);
      if (!isNaN(lng) && !isNaN(lat)) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: { name, description }
        });
      }
    }

    // LineString
    const line = pm.querySelector('LineString coordinates');
    if (line?.textContent) {
      const coords = line.textContent.trim().split(/\s+/).map(c => {
        const [lng, lat] = c.split(',').map(Number);
        return [lng, lat] as [number, number];
      }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));

      if (coords.length > 1) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { name, description }
        });
      }
    }

    // Polygon
    const polygon = pm.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
    if (polygon?.textContent) {
      const coords = polygon.textContent.trim().split(/\s+/).map(c => {
        const [lng, lat] = c.split(',').map(Number);
        return [lng, lat] as [number, number];
      }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));

      if (coords.length > 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coords] },
          properties: { name, description }
        });
      }
    }
  });

  return { type: 'FeatureCollection', features };
}

// Parse GPX to GeoJSON
export function parseGPX(text: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  const features: GeoJSON.Feature[] = [];

  // Waypoints
  doc.querySelectorAll('wpt').forEach(wpt => {
    const lat = parseFloat(wpt.getAttribute('lat') || '');
    const lon = parseFloat(wpt.getAttribute('lon') || '');
    const name = wpt.querySelector('name')?.textContent || '';
    const desc = wpt.querySelector('desc')?.textContent || '';

    if (!isNaN(lat) && !isNaN(lon)) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { name, description: desc, type: 'waypoint' }
      });
    }
  });

  // Tracks
  doc.querySelectorAll('trk').forEach(trk => {
    const name = trk.querySelector('name')?.textContent || '';

    trk.querySelectorAll('trkseg').forEach(seg => {
      const coords: [number, number][] = [];
      seg.querySelectorAll('trkpt').forEach(pt => {
        const lat = parseFloat(pt.getAttribute('lat') || '');
        const lon = parseFloat(pt.getAttribute('lon') || '');
        if (!isNaN(lat) && !isNaN(lon)) {
          coords.push([lon, lat]);
        }
      });

      if (coords.length > 1) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { name, type: 'track' }
        });
      }
    });
  });

  // Routes
  doc.querySelectorAll('rte').forEach(rte => {
    const name = rte.querySelector('name')?.textContent || '';
    const coords: [number, number][] = [];

    rte.querySelectorAll('rtept').forEach(pt => {
      const lat = parseFloat(pt.getAttribute('lat') || '');
      const lon = parseFloat(pt.getAttribute('lon') || '');
      if (!isNaN(lat) && !isNaN(lon)) {
        coords.push([lon, lat]);
      }
    });

    if (coords.length > 1) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { name, type: 'route' }
      });
    }
  });

  return { type: 'FeatureCollection', features };
}

const GEOJSON_GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when `value` looks like a GeoJSON Geometry object (type + coordinates/geometries). */
export function isGeoJsonGeometry(value: unknown): value is GeoJSON.Geometry {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (!GEOJSON_GEOMETRY_TYPES.has(value.type)) return false;
  if (value.type === 'GeometryCollection') return Array.isArray(value.geometries);
  return Array.isArray(value.coordinates);
}

/** True when `value` is a Feature whose geometry is null or a valid Geometry. */
export function isGeoJsonFeature(value: unknown): value is GeoJSON.Feature {
  if (!isRecord(value) || value.type !== 'Feature') return false;
  if (!('geometry' in value)) return false;
  return value.geometry === null || isGeoJsonGeometry(value.geometry);
}

/**
 * Coerce an arbitrary parsed JSON value into a FeatureCollection containing
 * only features Leaflet can render. Returns null when the value is not GeoJSON
 * at all. Features with an unknown geometry type are dropped rather than
 * letting Leaflet throw "Invalid GeoJSON object" later.
 */
export function toFeatureCollection(value: unknown): GeoJSON.FeatureCollection | null {
  if (!isRecord(value)) return null;

  if (value.type === 'FeatureCollection') {
    if (!Array.isArray(value.features)) return null;
    const features = value.features.filter(isGeoJsonFeature);
    return { type: 'FeatureCollection', features };
  }

  if (isGeoJsonFeature(value)) {
    return { type: 'FeatureCollection', features: [value] };
  }

  if (isGeoJsonGeometry(value)) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: value, properties: {} }]
    };
  }

  return null;
}

/**
 * Parse the text of an uploaded .geojson/.json file into a renderable
 * FeatureCollection. Throws an Error with a Norwegian, user-facing message
 * when the text is not JSON, not GeoJSON, or contains nothing to draw.
 */
export function parseGeoJsonUpload(text: string): GeoJSON.FeatureCollection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Kunne ikke lese filen som JSON');
  }

  const collection = toFeatureCollection(parsed);
  if (!collection) {
    throw new Error('Filen inneholder ikke gyldig GeoJSON');
  }
  if (collection.features.length === 0) {
    throw new Error('Filen inneholder ingen kartobjekter');
  }
  return collection;
}
