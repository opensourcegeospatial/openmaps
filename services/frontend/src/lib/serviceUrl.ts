/**
 * Resolve a user-typed OGC service address. Relative paths are resolved
 * against the page origin so internal services reached through the reverse
 * proxy (e.g. `/geoserver/wms`) work; anything unparsable gets a Norwegian
 * error instead of the browser's "Failed to construct 'URL'".
 */
export function resolveServiceUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Ugyldig tjeneste-URL');
  try {
    return new URL(trimmed, window.location.origin);
  } catch {
    throw new Error('Ugyldig tjeneste-URL');
  }
}
