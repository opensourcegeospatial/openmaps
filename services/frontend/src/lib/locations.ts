/**
 * Reconcile a list of named routing locations against a new set of coordinates.
 *
 * For each index, the previous location is kept as-is when its coordinates are
 * unchanged (preserving a reverse-geocoded or user-typed name), and only the
 * coordinates that actually moved (or are new) are re-reverse-geocoded. Used so
 * that dragging one waypoint refreshes that point's address without clobbering
 * the others — and so the names array stays index-aligned when waypoints are
 * added/removed.
 */
import type { MapLngLat } from '../components/Map';
import type { LocationWithName } from '../components/SideBar';

const sameCoords = (a: MapLngLat | undefined, b: MapLngLat | undefined): boolean =>
  !!a && !!b && a.lng === b.lng && a.lat === b.lat;

export async function reconcileLocations(
  prev: LocationWithName[],
  nextCoords: MapLngLat[],
  getName: (coords: MapLngLat) => Promise<string>
): Promise<LocationWithName[]> {
  return Promise.all(
    nextCoords.map(async (coords, i) => {
      const existing = prev[i];
      if (existing && sameCoords(existing.coords, coords)) return existing;
      return { coords, name: await getName(coords) };
    })
  );
}

/**
 * A via-point row in the navigation panel. `coords` is null while the row has
 * been added but no place has been picked for it yet; such rows are never sent
 * to the router or drawn on the map.
 */
export interface WaypointLocation {
  coords: MapLngLat | null;
  name: string;
}

/** Coordinates of the resolved rows only, in panel order. */
export const resolvedWaypointCoords = (rows: WaypointLocation[]): MapLngLat[] =>
  rows.flatMap((row) => (row.coords ? [row.coords] : []));

/**
 * Like {@link reconcileLocations}, but for the panel's row list, which may
 * contain unresolved rows. `nextResolved` carries only the resolved points (the
 * markers on the map); unresolved rows keep their positions.
 */
export async function reconcileWaypointLocations(
  prev: WaypointLocation[],
  nextResolved: MapLngLat[],
  getName: (coords: MapLngLat) => Promise<string>
): Promise<WaypointLocation[]> {
  const prevResolved = prev.filter((row): row is LocationWithName => row.coords !== null);
  const resolved = await reconcileLocations(prevResolved, nextResolved, getName);

  const out: WaypointLocation[] = [];
  let next = 0;
  for (const row of prev) {
    if (row.coords === null) {
      out.push(row);
    } else if (next < resolved.length) {
      out.push(resolved[next++]);
    }
    // A resolved row with no counterpart in nextResolved was removed.
  }
  while (next < resolved.length) out.push(resolved[next++]);
  return out;
}
