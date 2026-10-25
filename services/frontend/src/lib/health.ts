/**
 * Health check API client.
 *
 * Calls the backend /health aggregation endpoint which checks all services
 * in the OpenMaps stack concurrently and returns their status.
 */

export type ServiceStatus = 'healthy' | 'unhealthy' | 'starting';

export interface ServiceHealth {
  status: ServiceStatus;
  status_code?: number;
  detail?: string;
  /** Extra UIs the map does not need; they never fail the aggregate. */
  optional?: boolean;
}

export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  services: Record<string, ServiceHealth>;
}

/**
 * Fetch the aggregated health status from the backend.
 *
 * The backend `/health` endpoint is proxied via `/api/health` in
 * development (Vite proxy) and via nginx in production.
 *
 * Returns `null` when the backend itself is unreachable so callers
 * can distinguish "backend down" from "some services unhealthy".
 */
export async function fetchHealth(
  signal?: AbortSignal
): Promise<HealthResponse | null> {
  try {
    const res = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal,
    });

    // The backend returns 200 (all healthy) or 503 (some unhealthy).
    // Both carry a valid JSON body — parse either way.
    const data: HealthResponse = await res.json();

    // Normalise: if a service responded but with a connection-refused
    // detail, treat it as "starting" rather than "unhealthy" so the UI
    // can show a yellow indicator during boot.
    for (const [, svc] of Object.entries(data.services)) {
      if (
        svc.status === 'unhealthy' &&
        svc.detail === 'connection refused'
      ) {
        svc.status = 'starting';
      }
    }

    return data;
  } catch {
    // Network error / backend unreachable
    return null;
  }
}
