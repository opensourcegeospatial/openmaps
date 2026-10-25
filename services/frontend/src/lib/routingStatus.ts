import type { RouteResponse } from './graphhopper';
import { serviceFailureMessage } from './errors';

/** How a route is travelled. */
export type RoutingProfile = 'car' | 'foot' | 'bike';

/** The word each travel mode goes by, in the route panel and wherever a kept route is named. */
export const PROFILE_LABELS: Record<RoutingProfile, string> = {
  car: 'Kjør',
  foot: 'Gå',
  bike: 'Sykle'
};

/**
 * Status of an in-flight or completed routing request, surfaced in the UI:
 * - `idle`    no request running and nothing to report.
 * - `loading` a route is currently being computed.
 * - `empty`   the request succeeded but the backend found no route.
 * - `error`   the request failed (timeout / service / network error).
 */
export type RoutingStatus = 'idle' | 'loading' | 'empty' | 'error';

/**
 * Map a settled routing request to its resulting status.
 *
 * `getRoute` resolves to `null` when no route exists (too few waypoints or the
 * backend returned no usable routes) and throws on transport/service errors.
 */
export function statusForResult(response: RouteResponse | null): RoutingStatus {
  if (response && response.routes.length > 0) return 'idle';
  return 'empty';
}

/**
 * Why a route could not be calculated, for a failure that carries no message of
 * its own: the service does not answer, answered with an error, or could not
 * be reached at all. Each names the failure first, then the cause.
 */
export function routeFailureMessage(status?: number): string {
  return serviceFailureMessage('Kunne ikke beregne ruten', 'rutetjenesten', status);
}

// The `code` the backend puts on its 502 answer when the routing service
// refused the API key, and the sentence the user gets for it.
const KEY_FAILURE_MESSAGES = new Map<string, string>([
  ['graphhopper_key_rejected', 'Kunne ikke beregne ruten. Rutetjenesten avviste API-nøkkelen.'],
  ['graphhopper_key_quota', 'Kunne ikke beregne ruten. Kvoten for API-nøkkelen er brukt opp.']
]);

/**
 * Why a route could not be calculated when the backend says the routing service
 * refused its API key. These are the only backend answers whose cause the user
 * (or whoever runs the service) can act on; any other code gives `undefined`.
 */
export function keyFailureMessage(code: unknown): string | undefined {
  return typeof code === 'string' ? KEY_FAILURE_MESSAGES.get(code) : undefined;
}

/** Norwegian, user-facing messages for each non-idle routing status. */
export const ROUTING_STATUS_MESSAGES: Record<
  Exclude<RoutingStatus, 'idle'>,
  string
> = {
  loading: 'Beregner rute…',
  empty: 'Fant ingen rute mellom punktene. Prøv et annet reisemiddel, eller flytt punktene nærmere en vei.',
  error: 'Kunne ikke beregne ruten.'
};
