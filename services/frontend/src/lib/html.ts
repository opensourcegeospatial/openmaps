/**
 * HTML-escaping helpers for safely interpolating untrusted strings into
 * markup (e.g. Leaflet `bindPopup` / `setContent`).
 *
 * Untrusted sources include Overpass feature names, WFS/WCS properties and
 * user-uploaded GeoJSON/KML/CSV properties. Always run such values through
 * `escapeHtml` before placing them into raw HTML to prevent XSS.
 */
export function escapeHtml(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
