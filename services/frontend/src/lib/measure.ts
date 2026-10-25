/** A map vertex as Leaflet reports it (`L.LatLng` or a plain object). */
export interface LatLngLike {
  lat: number;
  lng: number;
}

/**
 * Finalise the vertex list of a measurement ended with a double-click.
 *
 * Leaflet fires `click` twice before `dblclick`, so the point the user
 * double-clicked on is recorded twice: once by the intended last click and
 * once by the double-click's second click. Drop that single trailing
 * duplicate. An intentional revisit earlier in the sequence is kept.
 */
export function finalizeMeasurementPoints<T extends LatLngLike>(points: T[]): T[] {
  if (points.length < 2) return points;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  if (last.lat === prev.lat && last.lng === prev.lng) {
    return points.slice(0, -1);
  }
  return points;
}
