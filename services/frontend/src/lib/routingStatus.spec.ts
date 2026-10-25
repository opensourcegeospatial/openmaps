import { describe, it, expect } from 'vitest';
import {
  statusForResult,
  ROUTING_STATUS_MESSAGES,
  type RoutingStatus
} from './routingStatus';
import type { RouteResponse } from './graphhopper';

const routeResponse = (count: number): RouteResponse => ({
  routes: Array.from({ length: count }, (_, i) => ({
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    distance: 100,
    time: 1000,
    instructions: [],
    primary: i === 0,
    routeIndex: i
  })),
  dashedSegments: []
});

describe('statusForResult', () => {
  it('returns idle when at least one route is present', () => {
    expect(statusForResult(routeResponse(1))).toBe<RoutingStatus>('idle');
    expect(statusForResult(routeResponse(3))).toBe<RoutingStatus>('idle');
  });

  it('returns empty when the response is null (no route found)', () => {
    expect(statusForResult(null)).toBe<RoutingStatus>('empty');
  });

  it('returns empty when the response has zero routes', () => {
    expect(statusForResult(routeResponse(0))).toBe<RoutingStatus>('empty');
  });
});

describe('ROUTING_STATUS_MESSAGES', () => {
  it('provides Norwegian, distinct messages for loading/empty/error', () => {
    expect(ROUTING_STATUS_MESSAGES.loading).toBe('Beregner rute…');
    expect(ROUTING_STATUS_MESSAGES.empty).toBe('Fant ingen rute mellom punktene. Prøv et annet reisemiddel, eller flytt punktene nærmere en vei.');
    expect(ROUTING_STATUS_MESSAGES.error).toBe('Kunne ikke beregne ruten.');
  });
});
