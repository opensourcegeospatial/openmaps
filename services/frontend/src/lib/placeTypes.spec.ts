import { describe, expect, it } from 'vitest';
import { translatePlaceType } from './placeTypes';

describe('translatePlaceType', () => {
  it('names the common Nominatim types in Norwegian', () => {
    expect(translatePlaceType('city')).toBe('By');
    expect(translatePlaceType('office')).toBe('Kontor');
    expect(translatePlaceType('station')).toBe('Stasjon');
    expect(translatePlaceType('place_of_worship')).toBe('Kirke eller gudshus');
  });
  it('is case- and whitespace-tolerant', () => {
    expect(translatePlaceType(' City ')).toBe('By');
  });
  it('leaves unknown types out rather than showing an English token', () => {
    expect(translatePlaceType('ski_jump')).toBeUndefined();
    expect(translatePlaceType('Point')).toBeUndefined();
    expect(translatePlaceType('')).toBeUndefined();
    expect(translatePlaceType(undefined)).toBeUndefined();
    expect(translatePlaceType(42)).toBeUndefined();
  });
});
