/**
 * Validation for the custom-layer list persisted in localStorage.
 *
 * The list is written by the Layer Manager and read back on every boot. A
 * malformed entry (a hand-edited value, a layer saved by an older build, or a
 * file layer whose data is not GeoJSON) must never reach Leaflet, because an
 * exception inside the layer-sync effect unmounts the whole app — and since
 * the entry is persisted, it would do so on every reload.
 */
import type {
  CustomLayerConfig,
  FileLayerConfig,
  OGCServiceConfig,
  XYZLayerConfig
} from '../components/LayerManager';
import { toFeatureCollection } from './layerParsers';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasStringId = (value: Record<string, unknown>): boolean =>
  typeof value.id === 'string' && value.id.length > 0;

function sanitizeFileLayer(value: Record<string, unknown>): FileLayerConfig | null {
  const collection = toFeatureCollection(value.data);
  if (!collection || collection.features.length === 0) return null;
  return { ...(value as unknown as FileLayerConfig), data: collection };
}

function sanitizeServiceLayer(value: Record<string, unknown>): OGCServiceConfig | null {
  if (typeof value.url !== 'string' || !Array.isArray(value.layers)) return null;
  const layers = value.layers.filter(
    (layer): layer is OGCServiceConfig['layers'][number] =>
      isRecord(layer) && typeof layer.name === 'string'
  );
  return { ...(value as unknown as OGCServiceConfig), layers };
}

function sanitizeXyzLayer(value: Record<string, unknown>): XYZLayerConfig | null {
  if (typeof value.url !== 'string') return null;
  return value as unknown as XYZLayerConfig;
}

/**
 * Return only the entries of a persisted layer list that are safe to render.
 * Anything that is not an array yields an empty list.
 */
export function sanitizeStoredLayers(raw: unknown): CustomLayerConfig[] {
  if (!Array.isArray(raw)) return [];

  const result: CustomLayerConfig[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !hasStringId(entry)) continue;
    let layer: CustomLayerConfig | null = null;
    switch (entry.type) {
      case 'file':
        layer = sanitizeFileLayer(entry);
        break;
      case 'ogc-service':
        layer = sanitizeServiceLayer(entry);
        break;
      case 'xyz':
        layer = sanitizeXyzLayer(entry);
        break;
      default:
        layer = null;
    }
    if (layer) result.push(layer);
  }
  return result;
}

export const STORED_LAYERS_KEY = 'customMapLayers';

/** Read and sanitise the persisted layer list; never throws. */
export function loadStoredLayers(storage: Pick<Storage, 'getItem'> | undefined): CustomLayerConfig[] {
  if (!storage) return [];
  try {
    const saved = storage.getItem(STORED_LAYERS_KEY);
    if (!saved) return [];
    return sanitizeStoredLayers(JSON.parse(saved));
  } catch {
    return [];
  }
}

/**
 * Upper bound (bytes of JSON) for one file layer's payload in localStorage.
 * The whole origin shares roughly 5 MB; a multi-MB upload would exhaust it,
 * fail every later write and, on some browsers, block the thread per write.
 */
export const STORED_LAYER_PAYLOAD_BUDGET = 1_500_000;

export interface StoredLayersSerialization {
  json: string;
  /** File layers left out because their payload exceeded the budget. */
  dropped: { id: string; name: string }[];
}

/**
 * Serialise the layer list for localStorage, omitting file layers whose own
 * payload exceeds `budgetBytes`. Service and tile layers carry no payload and
 * are always kept.
 */
export function serializeLayersForStorage(
  layers: CustomLayerConfig[],
  budgetBytes: number = STORED_LAYER_PAYLOAD_BUDGET
): StoredLayersSerialization {
  const dropped: { id: string; name: string }[] = [];
  const kept = layers.filter((layer) => {
    if (layer.type !== 'file') return true;
    const size = JSON.stringify(layer.data ?? null).length;
    if (size > budgetBytes) {
      dropped.push({ id: layer.id, name: layer.name });
      return false;
    }
    return true;
  });
  return { json: JSON.stringify(kept), dropped };
}
