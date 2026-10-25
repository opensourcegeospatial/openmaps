/**
 * The credit OpenStreetMap's licence (ODbL) asks for, in Norwegian. It is the
 * built-in default, and the fallback for any basemap that names no credit.
 */
export const OSM_CREDIT = '© OpenStreetMap-bidragsytere';

/**
 * Attribution HTML with its links flattened to text. Every href in a tile
 * credit points at a third-party site, and the app does not send its users
 * there; the credit itself stays, word for word.
 */
export function plainAttribution(html: string): string {
  return html
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
