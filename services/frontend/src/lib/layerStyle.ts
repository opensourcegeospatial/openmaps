/**
 * Resolve the stroke/fill colors for an uploaded file (CSV/KML/GPX/GeoJSON)
 * vector layer, preferring the user-chosen colors from the Layer Manager and
 * only falling back to a default when none were provided.
 *
 * Map.tsx previously hardcoded `mapColors.fileVector` here, which made every
 * uploaded layer render in the fallback colour regardless of the picker.
 */
export interface FileLayerColors {
  color: string;
  fillColor: string;
}

export function resolveFileLayerColors(
  style: { color?: string; fillColor?: string } | undefined,
  fallback: string
): FileLayerColors {
  const color = style?.color ?? fallback;
  const fillColor = style?.fillColor ?? style?.color ?? fallback;
  return { color, fillColor };
}
