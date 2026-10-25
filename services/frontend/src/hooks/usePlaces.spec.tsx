import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaces } from './usePlaces';
import { MAX_SAVED_PLACES, RECENT_PLACES_KEY, SAVED_PLACES_KEY } from '../lib/places';
import type { GeoJSONFeature } from '../lib/nominatim';

const feature = (name: string, lat: number, lng: number): GeoJSONFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { display_name: name }
});

beforeEach(() => {
  localStorage.clear();
});

describe('usePlaces', () => {
  it('records selections as recent searches, newest first, without duplicates', () => {
    const { result } = renderHook(() => usePlaces());
    act(() => result.current.addRecent(feature('Oslo', 59.91, 10.75)));
    act(() => result.current.addRecent(feature('Bergen', 60.39, 5.32)));
    act(() => result.current.addRecent(feature('Oslo', 59.91, 10.75)));

    expect(result.current.recent.map((p) => p.name)).toEqual(['Oslo', 'Bergen']);
    expect(JSON.parse(localStorage.getItem(RECENT_PLACES_KEY) ?? '[]')).toHaveLength(2);
  });

  it('toggles a place in and out of Mine steder and persists it', () => {
    const { result } = renderHook(() => usePlaces());
    const oslo = feature('Oslo', 59.91, 10.75);

    let outcome = '';
    act(() => {
      outcome = result.current.toggleSaved(oslo);
    });
    expect(outcome).toBe('added');
    expect(result.current.isFeatureSaved(oslo)).toBe(true);
    expect(JSON.parse(localStorage.getItem(SAVED_PLACES_KEY) ?? '[]')[0].name).toBe('Oslo');

    act(() => {
      outcome = result.current.toggleSaved(oslo);
    });
    expect(outcome).toBe('removed');
    expect(result.current.saved).toEqual([]);
    expect(result.current.isFeatureSaved(oslo)).toBe(false);
  });

  it('reports a full list instead of dropping a saved place', () => {
    const { result } = renderHook(() => usePlaces());
    for (let i = 0; i < MAX_SAVED_PLACES; i += 1) {
      act(() => {
        result.current.toggleSaved(feature(`Sted ${i}`, 59 + i * 0.001, 10));
      });
    }
    let outcome = '';
    act(() => {
      outcome = result.current.toggleSaved(feature('En til', 61, 10));
    });
    expect(outcome).toBe('full');
    expect(result.current.saved).toHaveLength(MAX_SAVED_PLACES);
  });

  it('ignores a feature that cannot be stored', () => {
    const { result } = renderHook(() => usePlaces());
    const nameless: GeoJSONFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [10, 59] },
      properties: {}
    };
    let outcome = '';
    act(() => {
      result.current.addRecent(nameless);
      outcome = result.current.toggleSaved(nameless);
    });
    expect(outcome).toBe('unsupported');
    expect(result.current.recent).toEqual([]);
    expect(result.current.isFeatureSaved(null)).toBe(false);
  });

  it('rehydrates both lists from storage and can clear the recent ones', () => {
    localStorage.setItem(RECENT_PLACES_KEY, JSON.stringify([{ id: 'r', name: 'Nylig', lat: 59, lng: 10, savedAt: 1 }]));
    localStorage.setItem(SAVED_PLACES_KEY, JSON.stringify([{ id: 's', name: 'Lagret', lat: 59, lng: 10, savedAt: 1 }]));
    const { result } = renderHook(() => usePlaces());
    expect(result.current.recent[0].name).toBe('Nylig');
    expect(result.current.saved[0].name).toBe('Lagret');

    act(() => {
      result.current.clearRecent();
    });
    expect(result.current.recent).toEqual([]);
    expect(localStorage.getItem(RECENT_PLACES_KEY)).toBe('[]');
    expect(result.current.saved[0].name).toBe('Lagret');
  });

  it('puts a removed place back where it stood, once, and says when the list filled up meanwhile', () => {
    const { result } = renderHook(() => usePlaces());
    const names = ['Oslo', 'Bergen', 'Trondheim'];
    names.forEach((name, i) => act(() => void result.current.toggleSaved(feature(name, 59 + i, 10 + i))));
    // Newest first: Trondheim, Bergen, Oslo.
    const index = result.current.saved.findIndex((p) => p.name === 'Bergen');
    const bergen = result.current.saved[index];
    act(() => void result.current.toggleSaved(feature('Bergen', 60, 11)));
    expect(result.current.saved.map((p) => p.name)).toEqual(['Trondheim', 'Oslo']);

    let restored = false;
    act(() => {
      restored = result.current.restoreSaved(bergen, { index });
    });
    expect(restored).toBe(true);
    expect(result.current.saved.map((p) => p.name)).toEqual(['Trondheim', 'Bergen', 'Oslo']);
    expect(result.current.saved[1]).toEqual(bergen);
    expect(JSON.parse(localStorage.getItem(SAVED_PLACES_KEY) ?? '[]')).toHaveLength(3);

    // A second "Angre" changes nothing.
    act(() => {
      restored = result.current.restoreSaved(bergen, { index });
    });
    expect(restored).toBe(true);
    expect(result.current.saved).toHaveLength(3);

    // Removed, then the list filled in the meantime: nothing is dropped to make room.
    act(() => void result.current.toggleSaved(feature('Bergen', 60, 11)));
    for (let i = result.current.saved.length; i < MAX_SAVED_PLACES; i++) {
      act(() => void result.current.toggleSaved(feature(`Sted ${i}`, 61 + i / 100, 12)));
    }
    expect(result.current.saved).toHaveLength(MAX_SAVED_PLACES);
    act(() => {
      restored = result.current.restoreSaved(bergen, { index });
    });
    expect(restored).toBe(false);
    expect(result.current.saved).toHaveLength(MAX_SAVED_PLACES);
    expect(result.current.saved.some((p) => p.name === 'Bergen')).toBe(false);
  });

  // Once the list has changed, a raw index points into the wrong gap; the
  // place goes back beside the neighbours it had (critique run 13).
  it('puts a removed place back beside its old neighbours, not at a stale index', () => {
    const { result } = renderHook(() => usePlaces());
    ['Oslo', 'Bergen', 'Trondheim'].forEach((name, i) =>
      act(() => void result.current.toggleSaved(feature(name, 59 + i, 10 + i)))
    );
    // Newest first: Trondheim, Bergen, Oslo.
    const index = result.current.saved.findIndex((p) => p.name === 'Bergen');
    const bergen = result.current.saved[index];
    const position = {
      index,
      previousId: result.current.saved[index - 1].id,
      nextId: result.current.saved[index + 1].id
    };
    act(() => void result.current.toggleSaved(feature('Bergen', 60, 11)));
    // A place saved in the meantime goes on top and shifts every index.
    act(() => void result.current.toggleSaved(feature('Stavanger', 58.97, 5.73)));
    act(() => void result.current.restoreSaved(bergen, position));
    expect(result.current.saved.map((p) => p.name)).toEqual(['Stavanger', 'Trondheim', 'Bergen', 'Oslo']);
  });

  it('brings cleared recent searches back below a search made since', () => {
    const { result } = renderHook(() => usePlaces());
    act(() => result.current.addRecent(feature('Oslo', 59.91, 10.75)));
    act(() => result.current.addRecent(feature('Bergen', 60.39, 5.32)));
    let previous: ReturnType<typeof result.current.clearRecent> = [];
    act(() => {
      previous = result.current.clearRecent();
    });
    act(() => result.current.addRecent(feature('Tromsø', 69.65, 18.96)));
    act(() => result.current.restoreRecent(previous));
    expect(result.current.recent.map((p) => p.name)).toEqual(['Tromsø', 'Bergen', 'Oslo']);
  });
});
