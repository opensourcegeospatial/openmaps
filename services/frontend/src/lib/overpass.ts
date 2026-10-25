import type { GeoJSONFeature } from './nominatim';
import { loadMapConfig } from '../config/map.config';
import { fetchWithTimeout } from './fetchWithTimeout';
import { serviceFailureMessage } from './errors';

/**
 * Which engine read the question: the network language model, the bundled
 * local model, or the keyword search the backend falls back to.
 */
export type OverpassGenerator = 'llm' | 'byt5' | 'keyword';

export interface OverpassResult {
    features: GeoJSONFeature[];
    /** Absent when the backend does not say. */
    generator?: OverpassGenerator;
    /** The Overpass query that ran, when the backend says. */
    overpassQuery?: string;
}

/** What the results panel needs to restate the question and how it was read. */
export interface OverpassSearchMeta {
    query: string;
    generator?: OverpassGenerator;
    /** The Overpass query that ran, when the backend says. */
    overpassQuery?: string;
    /**
     * The extent that was searched, as [west, south, east, north]: the map's
     * view when the question was asked. The answer is true only inside it.
     */
    bbox?: [number, number, number, number];
}

const isGenerator = (value: unknown): value is OverpassGenerator =>
    value === 'llm' || value === 'byt5' || value === 'keyword';

export async function searchOverpass(
    query: string,
    bounds: [number, number, number, number],
    signal?: AbortSignal
): Promise<OverpassResult> {
    const [west, south, east, north] = bounds;

    const params = new URLSearchParams({
        nl: query,
        south: south.toString(),
        west: west.toString(),
        north: north.toString(),
        east: east.toString()
    });

    // Load config to get the API endpoint
    const config = await loadMapConfig();
    // The backend runs the byt5 NL model for Overpass search; CPU inference can
    // take tens of seconds (longer on a memory-constrained host), so allow a
    // multi-minute timeout rather than the 15s default.
    const OVERPASS_TIMEOUT_MS = 5 * 60 * 1000;
    const response = await fetchWithTimeout(`${config.apiEndpoints.overpass}?${params}`, {
        timeoutMs: OVERPASS_TIMEOUT_MS,
        signal
    });

    if (!response.ok) {
        // Our own sentence for the status: never the backend's detail (it names
        // internal services) and never statusText (English, empty over HTTP/2).
        console.warn(`[overpass] search failed with status ${response.status}`);
        throw new Error(serviceFailureMessage('Søket i området kunne ikke utføres', 'søketjenesten', response.status));
    }

    const data: unknown = await response.json().catch(() => null);
    const features = (data as { features?: unknown } | null)?.features;
    if (!Array.isArray(features)) {
        throw new Error('Ugyldig svar fra Overpass-tjenesten');
    }
    const generator = (data as { generator?: unknown } | null)?.generator;
    const overpassQuery = (data as { query?: unknown } | null)?.query;
    return {
        features: features as GeoJSONFeature[],
        generator: isGenerator(generator) ? generator : undefined,
        overpassQuery: typeof overpassQuery === 'string' && overpassQuery.trim() ? overpassQuery : undefined
    };
}
