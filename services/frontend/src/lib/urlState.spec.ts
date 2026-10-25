import { describe, it, expect } from 'vitest';
import {
  parseMapHash,
  serializeMapHash,
  type MapHashState
} from './urlState';

describe('serializeMapHash', () => {
  it('serializes a full view + style + route', () => {
    const state: MapHashState = {
      view: { zoom: 14, lat: 59.9139, lng: 10.7522 },
      style: 'osm',
      route: [
        { lat: 59.91, lng: 10.75 },
        { lat: 59.95, lng: 10.8 }
      ]
    };
    expect(serializeMapHash(state)).toBe(
      '#map=14/59.9139/10.7522&style=osm&route=59.91,10.75;59.95,10.8'
    );
  });

  it('serializes view only', () => {
    expect(serializeMapHash({ view: { zoom: 8, lat: 0, lng: 0 } })).toBe('#map=8/0/0');
  });

  it('rounds lat/lng to ~5 decimals and zoom to an int', () => {
    expect(
      serializeMapHash({ view: { zoom: 12.7, lat: 59.913912345, lng: 10.752234999 } })
    ).toBe('#map=13/59.91391/10.75223');
  });

  it('clamps out-of-range values', () => {
    expect(
      serializeMapHash({ view: { zoom: 99, lat: 200, lng: -999 } })
    ).toBe('#map=22/90/-180');
  });

  it('returns an empty string for an empty state', () => {
    expect(serializeMapHash({})).toBe('');
  });

  it('omits an empty route', () => {
    expect(serializeMapHash({ view: { zoom: 5, lat: 1, lng: 2 }, route: [] })).toBe(
      '#map=5/1/2'
    );
  });
});

describe('parseMapHash', () => {
  it('parses a full hash', () => {
    expect(parseMapHash('#map=14/59.9139/10.7522&style=osm&route=59.91,10.75;59.95,10.8')).toEqual({
      view: { zoom: 14, lat: 59.9139, lng: 10.7522 },
      style: 'osm',
      route: [
        { lat: 59.91, lng: 10.75 },
        { lat: 59.95, lng: 10.8 }
      ]
    });
  });

  it('parses without a leading #', () => {
    expect(parseMapHash('map=10/1/2')).toEqual({ view: { zoom: 10, lat: 1, lng: 2 } });
  });

  it('tolerates a leading slash', () => {
    expect(parseMapHash('#/map=10/1/2')).toEqual({ view: { zoom: 10, lat: 1, lng: 2 } });
  });

  it('returns null for empty / non-string input', () => {
    expect(parseMapHash('')).toBeNull();
    expect(parseMapHash('#')).toBeNull();
    // @ts-expect-error testing runtime robustness
    expect(parseMapHash(null)).toBeNull();
  });

  it('returns null when nothing usable is present', () => {
    expect(parseMapHash('#foo=bar&baz')).toBeNull();
  });

  it('ignores unknown keys but keeps known ones', () => {
    expect(parseMapHash('#map=9/3/4&unknown=x&zoom=99')).toEqual({
      view: { zoom: 9, lat: 3, lng: 4 }
    });
  });

  it('returns partial state when the view is malformed but style is valid', () => {
    expect(parseMapHash('#map=not/a/view&style=topo')).toEqual({ style: 'topo' });
  });

  it('rejects a view with the wrong number of parts', () => {
    expect(parseMapHash('#map=14/59.9')).toBeNull();
    expect(parseMapHash('#map=14/59.9/10.7/extra')).toBeNull();
  });

  it('clamps and rounds the parsed view', () => {
    expect(parseMapHash('#map=50/120/-400')).toEqual({
      view: { zoom: 22, lat: 90, lng: -180 }
    });
    expect(parseMapHash('#map=12.6/1/2')).toEqual({
      view: { zoom: 13, lat: 1, lng: 2 }
    });
  });

  it('skips malformed route points but keeps valid ones', () => {
    expect(parseMapHash('#route=59.9,10.7;bad;1,2,3;59.95,10.8')).toEqual({
      route: [
        { lat: 59.9, lng: 10.7 },
        { lat: 59.95, lng: 10.8 }
      ]
    });
  });

  it('ignores an empty style value', () => {
    expect(parseMapHash('#map=5/1/2&style=')).toEqual({ view: { zoom: 5, lat: 1, lng: 2 } });
  });
});

describe('round-trip', () => {
  it('serialize -> parse yields the original state', () => {
    const state: MapHashState = {
      view: { zoom: 16, lat: 59.91391, lng: 10.75223 },
      style: 'cartodb-dark',
      route: [
        { lat: 59.9, lng: 10.7 },
        { lat: 60.0, lng: 10.8 },
        { lat: 60.1, lng: 10.9 }
      ]
    };
    expect(parseMapHash(serializeMapHash(state))).toEqual(state);
  });

  it('parse -> serialize is stable for a canonical hash', () => {
    const hash = '#map=14/59.9139/10.7522&style=osm&route=59.91,10.75;59.95,10.8';
    const parsed = parseMapHash(hash);
    expect(parsed).not.toBeNull();
    expect(serializeMapHash(parsed as MapHashState)).toBe(hash);
  });
});

describe('parseMapHash robustness', () => {
  it('skips a segment with malformed percent-encoding instead of throwing', () => {
    expect(parseMapHash('#map=5/1/2&style=%')).toEqual({ view: { zoom: 5, lat: 1, lng: 2 } });
    expect(parseMapHash('#map=5/1/2&style=%E0%A4%A')).toEqual({
      view: { zoom: 5, lat: 1, lng: 2 }
    });
  });
});

describe('streetview flag', () => {
  it('serializes the flag only when the layer is on', () => {
    expect(serializeMapHash({ view: { zoom: 15, lat: 59.9, lng: 10.7 }, streetview: true })).toBe(
      '#map=15/59.9/10.7&streetview=1'
    );
    expect(serializeMapHash({ view: { zoom: 15, lat: 59.9, lng: 10.7 }, streetview: false })).toBe(
      '#map=15/59.9/10.7'
    );
  });

  it('parses 1 / true / on as on and anything else as absent', () => {
    expect(parseMapHash('#map=15/59.9/10.7&streetview=1')?.streetview).toBe(true);
    expect(parseMapHash('#streetview=true')?.streetview).toBe(true);
    expect(parseMapHash('#streetview=on')?.streetview).toBe(true);
    expect(parseMapHash('#map=15/59.9/10.7&streetview=0')?.streetview).toBeUndefined();
    expect(parseMapHash('#streetview=0')).toBeNull();
  });
});
