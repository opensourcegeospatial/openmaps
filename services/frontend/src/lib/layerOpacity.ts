/**
 * Opacity helpers for custom layers.
 *
 * Tile layers expose `setOpacity`; vector (GeoJSON) layers do not, so their
 * opacity used to be baked into the style at creation and the slider did
 * nothing afterwards. Service-level opacity (the slider on an OGC service
 * card) is multiplied into each of its sub-layers.
 */
import type L from 'leaflet';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Combined opacity of a sub-layer under a service with its own opacity. */
export function effectiveLayerOpacity(serviceOpacity: number | undefined, layerOpacity: number): number {
  const service = typeof serviceOpacity === 'number' && Number.isFinite(serviceOpacity)
    ? clamp01(serviceOpacity)
    : 1;
  return clamp01(service * clamp01(layerOpacity));
}

/** Fill opacity relative to stroke opacity: points read stronger than areas. */
export const POINT_FILL_FACTOR = 0.5;
export const AREA_FILL_FACTOR = 0.3;

/** Apply `opacity` to every sub-layer of a GeoJSON layer (stroke + fill). */
export function applyVectorLayerOpacity(layer: L.GeoJSON, opacity: number): void {
  const value = clamp01(opacity);
  layer.setStyle((feature) => {
    const isPoint = feature?.geometry?.type === 'Point' || feature?.geometry?.type === 'MultiPoint';
    return {
      opacity: value,
      fillOpacity: value * (isPoint ? POINT_FILL_FACTOR : AREA_FILL_FACTOR)
    };
  });
}
