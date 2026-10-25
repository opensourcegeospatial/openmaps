import { describe, it, expect } from 'vitest';
import {
  MAX_RECENT_PLACES,
  MAX_SAVED_PLACES,
  addSaved,
  isSaved,
  loadPlaces,
  pushRecent,
  removeSaved,
  sanitizeStoredPlaces,
  savePlaces,
  toFeature,
  toStoredPlace,
  type StoredPlace
} from './places';
import type { GeoJSONFeature } from './nominatim';

const pointFeature = (
  name: string,
  lat: number,
  lng: number,
  extra: Record<string, unknown> = {}
): GeoJSONFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { display_name: name, ...extra }
});

const place = (id: string, name = id, savedAt = 0): StoredPlace => ({
  id,
  name,
  lat: 59.9,
  lng: 10.7,
  savedAt
});

describe('toStoredPlace', () => {
  it('uses the OSM identity and the point location', () => {
    const stored = toStoredPlace(
      pointFeature('Oslo, Norge', 59.9139, 10.7522, {
        osm_type: 'relation',
        osm_id: 406091,
        type: 'city'
      }),
      1234
    );
    expect(stored).toEqual({
      id: 'relation:406091',
      name: 'Oslo, Norge',
      lat: 59.9139,
      lng: 10.7522,
      category: 'city',
      savedAt: 1234
    });
  });

  it('falls back to the name and coordinates when there is no OSM id', () => {
    expect(toStoredPlace(pointFeature('Et sted', 60.5, 8.25), 1)?.id).toBe('Et sted@60.50000,8.25000');
  });

  it('takes the bbox centre for area results and keeps the bbox', () => {
    const area: GeoJSONFeature = {
      type: 'Feature',
      bbox: [10.0, 59.0, 11.0, 60.0],
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [10, 59],
            [11, 59],
            [11, 60],
            [10, 60],
            [10, 59]
          ]
        ]
      },
      properties: { display_name: 'Område' }
    };
    expect(toStoredPlace(area, 1)).toMatchObject({ lat: 59.5, lng: 10.5, bbox: [10.0, 59.0, 11.0, 60.0] });
  });

  it('returns null without a name or a usable location', () => {
    expect(toStoredPlace(pointFeature('', 59.9, 10.7), 1)).toBeNull();
    expect(
      toStoredPlace(
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { display_name: 'X' } },
        1
      )
    ).toBeNull();
  });
});

describe('toFeature', () => {
  it('builds a point feature the sidebar and the map can use', () => {
    const feature = toFeature({
      id: 'node:1',
      name: 'Oslo S',
      lat: 59.911,
      lng: 10.7527,
      category: 'station',
      savedAt: 5,
      bbox: [10.75, 59.91, 10.76, 59.92]
    });
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [10.7527, 59.911] });
    expect(feature.bbox).toEqual([10.75, 59.91, 10.76, 59.92]);
    expect(feature.properties).toEqual({
      display_name: 'Oslo S',
      name: 'Oslo S',
      type: 'station',
      stored_place_id: 'node:1'
    });
  });

  it('round-trips through toStoredPlace with the same identity', () => {
    const original: StoredPlace = { id: 'way:9', name: 'Bryggen', lat: 60.397, lng: 5.324, savedAt: 3 };
    expect(toStoredPlace(toFeature(original), 3)).toEqual(original);
  });
});

describe('sanitizeStoredPlaces', () => {
  it('drops malformed entries and duplicates, keeps valid ones', () => {
    const raw = [
      { id: 'a', name: 'A', lat: 59.9, lng: 10.7, savedAt: 1, category: 'city' },
      { id: 'a', name: 'A again', lat: 59.9, lng: 10.7, savedAt: 2 },
      { id: 'b', name: 'B', lat: 95, lng: 10.7, savedAt: 1 },
      { id: 'c', name: '', lat: 59.9, lng: 10.7 },
      { id: 'd', name: 'D', lat: '59.9', lng: 10.7 },
      'junk',
      { id: 'e', name: 'E', lat: 59.9, lng: 10.7, savedAt: 'x', bbox: [1, 2, 3] }
    ];
    expect(sanitizeStoredPlaces(raw)).toEqual([
      { id: 'a', name: 'A', lat: 59.9, lng: 10.7, savedAt: 1, category: 'city' },
      { id: 'e', name: 'E', lat: 59.9, lng: 10.7, savedAt: 0 }
    ]);
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(sanitizeStoredPlaces(null)).toEqual([]);
    expect(sanitizeStoredPlaces({ id: 'a' })).toEqual([]);
    expect(sanitizeStoredPlaces('[]')).toEqual([]);
  });
});

describe('storage', () => {
  const memoryStorage = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      }
    };
  };

  it('loads what it saved and never throws on a broken or missing store', () => {
    const storage = memoryStorage();
    expect(savePlaces(storage, 'k', [place('a')])).toBe(true);
    expect(loadPlaces(storage, 'k')).toEqual([place('a')]);

    storage.data.set('k', '{not json');
    expect(loadPlaces(storage, 'k')).toEqual([]);

    const failing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      }
    };
    expect(loadPlaces(failing, 'k')).toEqual([]);
    expect(savePlaces(failing, 'k', [])).toBe(false);
    expect(loadPlaces(undefined, 'k')).toEqual([]);
    expect(savePlaces(undefined, 'k', [])).toBe(false);
  });
});

describe('recent list', () => {
  it('puts the newest first, removes duplicates and caps the length', () => {
    let list: StoredPlace[] = [];
    for (let i = 0; i < MAX_RECENT_PLACES + 2; i += 1) list = pushRecent(list, place(`p${i}`));
    expect(list).toHaveLength(MAX_RECENT_PLACES);
    expect(list[0].id).toBe(`p${MAX_RECENT_PLACES + 1}`);

    list = pushRecent(list, place('p5'));
    expect(list[0].id).toBe('p5');
    expect(list.filter((p) => p.id === 'p5')).toHaveLength(1);
    expect(list).toHaveLength(MAX_RECENT_PLACES);
  });
});

describe('saved list', () => {
  it('adds once, refuses when full, removes by id', () => {
    const one = addSaved([], place('a'));
    expect(one).toEqual([place('a')]);
    expect(addSaved(one!, place('a'))).toBe(one);
    expect(isSaved(one!, 'a')).toBe(true);

    const full = Array.from({ length: MAX_SAVED_PLACES }, (_, i) => place(`s${i}`));
    expect(addSaved(full, place('one-more'))).toBeNull();

    const none = removeSaved(one!, 'a');
    expect(none).toEqual([]);
    expect(isSaved(none, 'a')).toBe(false);
  });
});
