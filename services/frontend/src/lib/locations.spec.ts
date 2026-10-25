import { describe, it, expect, vi } from 'vitest';
import { reconcileLocations, reconcileWaypointLocations, resolvedWaypointCoords } from './locations';

const a = { lng: 10, lat: 60 };
const b = { lng: 11, lat: 61 };

describe('reconcileLocations', () => {
  it('re-resolves only coordinates that moved, preserving unchanged names', async () => {
    const prev = [
      { coords: a, name: 'Alpha' },
      { coords: b, name: 'Bravo (custom)' }
    ];
    const bMoved = { lng: 12, lat: 62 };
    const getName = vi.fn(async (c: typeof a) => `resolved@${c.lng}`);

    const out = await reconcileLocations(prev, [a, bMoved], getName);

    expect(out).toEqual([
      { coords: a, name: 'Alpha' }, // unchanged → preserved
      { coords: bMoved, name: 'resolved@12' } // moved → re-resolved
    ]);
    expect(getName).toHaveBeenCalledTimes(1);
    expect(getName).toHaveBeenCalledWith(bMoved);
  });

  it('resolves a new coordinate that has no previous entry', async () => {
    const getName = vi.fn(async (c: typeof a) => `r@${c.lng}`);
    expect(await reconcileLocations([], [a], getName)).toEqual([{ coords: a, name: 'r@10' }]);
  });

  it('drops trailing names when a waypoint is removed (no re-resolve needed)', async () => {
    const prev = [
      { coords: a, name: 'A' },
      { coords: b, name: 'B' }
    ];
    const getName = vi.fn(async () => 'x');
    const out = await reconcileLocations(prev, [a], getName);
    expect(out).toEqual([{ coords: a, name: 'A' }]);
    expect(getName).not.toHaveBeenCalled();
  });
});

describe('reconcileWaypointLocations', () => {
  it('keeps unresolved rows in place and re-names only the resolved points that moved', async () => {
    const prev = [
      { coords: { lng: 1, lat: 1 }, name: 'A' },
      { coords: null, name: '' },
      { coords: { lng: 2, lat: 2 }, name: 'B' }
    ];
    const getName = vi.fn(async (c: { lng: number; lat: number }) => `n${c.lng}`);
    const next = await reconcileWaypointLocations(
      prev,
      [
        { lng: 1, lat: 1 },
        { lng: 3, lat: 3 }
      ],
      getName
    );
    expect(next).toEqual([
      { coords: { lng: 1, lat: 1 }, name: 'A' },
      { coords: null, name: '' },
      { coords: { lng: 3, lat: 3 }, name: 'n3' }
    ]);
    expect(getName).toHaveBeenCalledTimes(1);
  });

  it('appends resolved points that have no previous row', async () => {
    const getName = vi.fn(async () => 'ny');
    const next = await reconcileWaypointLocations([], [{ lng: 5, lat: 5 }], getName);
    expect(next).toEqual([{ coords: { lng: 5, lat: 5 }, name: 'ny' }]);
  });
});

describe('resolvedWaypointCoords', () => {
  it('returns only the coordinates of resolved rows, in order', () => {
    expect(
      resolvedWaypointCoords([
        { coords: null, name: '' },
        { coords: { lng: 1, lat: 2 }, name: 'x' },
        { coords: null, name: '' },
        { coords: { lng: 3, lat: 4 }, name: 'y' }
      ])
    ).toEqual([
      { lng: 1, lat: 2 },
      { lng: 3, lat: 4 }
    ]);
  });
});
