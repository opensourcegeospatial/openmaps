/**
 * Build the Leaflet layer for an uploaded file layer.
 *
 * Kept outside Map.tsx so it can be unit-tested and, more importantly, so a
 * data problem can never throw inside the map's layer-sync effect: Leaflet's
 * "Invalid GeoJSON object" exception there would unmount the whole app.
 */
import L from 'leaflet';
import type { FileLayerConfig } from '../components/LayerManager';
import { escapeHtml } from './html';
import { mapColors } from './mapColors';
import { resolveFileLayerColors } from './layerStyle';
import { toFeatureCollection } from './layerParsers';

/** Popup listing up to ten non-empty properties, every value escaped. */
function propertiesPopup(properties: Record<string, unknown> | null | undefined): string {
  if (!properties) return '';
  return Object.entries(properties)
    .filter(([, v]) => v !== null && v !== undefined)
    .slice(0, 10)
    .map(([k, v]) => `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}`)
    .join('<br>');
}

/**
 * Returns the vector layer for `fileConfig`, or null when its data cannot be
 * drawn. Never throws.
 */
export function buildFileVectorLayer(fileConfig: FileLayerConfig): L.GeoJSON | null {
  const collection = toFeatureCollection(fileConfig.data);
  if (!collection || collection.features.length === 0) return null;

  const { color: fileColor, fillColor: fileFill } = resolveFileLayerColors(
    fileConfig.style,
    mapColors.fileVector
  );
  const fileWeight = fileConfig.style?.weight ?? 2;
  const fileRadius = fileConfig.style?.radius ?? 6;

  try {
    return L.geoJSON(collection, {
      style: {
        color: fileColor,
        weight: fileWeight,
        fillColor: fileFill,
        fillOpacity: fileConfig.opacity * 0.3
      },
      pointToLayer: (_, latlng) =>
        L.circleMarker(latlng, {
          radius: fileRadius,
          fillColor: fileFill,
          color: fileColor,
          weight: fileWeight,
          fillOpacity: fileConfig.opacity * 0.5
        }),
      onEachFeature: (feature, layer) => {
        const html = propertiesPopup(feature.properties);
        if (html) layer.bindPopup(html);
      }
    });
  } catch (error) {
    console.error(`Kunne ikke tegne fillaget «${fileConfig.name}»:`, error);
    return null;
  }
}
