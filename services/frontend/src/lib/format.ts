/**
 * Norwegian (nb-NO) number formatting for distances, areas and durations:
 * a comma as the decimal mark ("1,2 km"), the locale's own grouping, and no
 * more precision than the value deserves. Everything user-facing that shows a
 * number goes through here so the route panel, the measurement popups and the
 * toasts agree.
 */

const nb = (maximumFractionDigits: number) =>
  new Intl.NumberFormat('nb-NO', { maximumFractionDigits });

/** Route or step length: metres below a kilometre ("850 m"), else "1,2 km". Empty for nothing. */
export function formatKm(meters: number | undefined | null): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) return '';
  if (meters < 1000) return `${nb(0).format(meters)} m`;
  return `${nb(1).format(meters / 1000)} km`;
}

/** Route or step duration: "12 min", "1 t 35 min", "under 1 min". Empty for nothing. */
export function formatMinutes(milliseconds: number | undefined | null): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '';
  }
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 1) return 'under 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} t ${rest} min` : `${hours} t`;
}

/** Measured distance: "12,5 m" below a kilometre, else "1,25 km". */
export function formatMeasuredDistance(meters: number): string {
  if (meters >= 1000) return `${nb(2).format(meters / 1000)} km`;
  return `${nb(1).format(meters)} m`;
}

/**
 * Measured area, in square metres or square kilometres only — no hectares
 * (decided 2026-09-23): "250,5 m²", "12 500 m²", then "2,5 km²" from a square
 * kilometre. Whole square metres from 10 000 m², where a decimal would claim a
 * precision no hand-drawn shape has.
 */
export function formatMeasuredArea(sqMeters: number): string {
  if (sqMeters >= 1_000_000) return `${nb(2).format(sqMeters / 1_000_000)} km²`;
  return `${nb(sqMeters >= 10_000 ? 0 : 1).format(sqMeters)} m²`;
}

/** Whole metres, grouped: "64 m", "1 240 m" (climb, descent). */
export function formatMetres(meters: number): string {
  return `${nb(0).format(meters)} m`;
}

/** A height above sea level: "41 moh." */
export function formatHeight(meters: number): string {
  return `${nb(0).format(meters)} moh.`;
}

const coordinate = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 5, maximumFractionDigits: 5 });

/**
 * A position as people read it: latitude first, five decimals (about a metre),
 * a Norwegian comma and a hemisphere letter — "59,91379° N, 10,74459° Ø".
 * The one format for the context menu and for fallbacks when a point has no address.
 */
export function formatLatLng(lat: number, lng: number): string {
  return `${coordinate.format(Math.abs(lat))}° ${lat < 0 ? 'S' : 'N'}, ${coordinate.format(Math.abs(lng))}° ${lng < 0 ? 'V' : 'Ø'}`;
}
