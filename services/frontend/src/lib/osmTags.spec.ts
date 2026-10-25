import { describe, it, expect } from 'vitest';
import {
  formatCuisine,
  formatOpeningHours,
  formatOsmDate,
  translateTagKey,
  translateTagValue
} from './osmTags';

describe('formatOpeningHours', () => {
  it('turns day codes, ranges and rule separators into Norwegian', () => {
    expect(formatOpeningHours('Mo-Fr 09:00-17:00; Sa 10:00-14:00')).toBe(
      'man.–fre. 09:00–17:00 · lør. 10:00–14:00'
    );
  });

  it('knows the always-open and closed forms', () => {
    expect(formatOpeningHours('24/7')).toBe('Døgnåpent');
    expect(formatOpeningHours('Mo-Fr 08:00-16:00; Su off')).toBe('man.–fre. 08:00–16:00 · søn. stengt');
    expect(formatOpeningHours('PH off')).toBe('helligdager stengt');
  });

  it('passes unknown syntax through', () => {
    expect(formatOpeningHours('sunrise-sunset')).toBe('sunrise–sunset');
    expect(formatOpeningHours('')).toBe('');
  });
});

describe('translateTagKey', () => {
  it('labels common keys and known namespaced keys without a double colon', () => {
    expect(translateTagKey('operator')).toBe('Drives av');
    expect(translateTagKey('ref:bygningsnr')).toBe('Bygningsnummer');
    expect(translateTagKey('dispensing')).toBe('Reseptutlevering');
    expect(translateTagKey('payment:cash')).toBe('Betaling, kontant');
    expect(translateTagKey('name:en')).toBe('Navn, en');
  });

  it('returns undefined when there is no Norwegian name, instead of an English label', () => {
    expect(translateTagKey('roof:shape')).toBeUndefined();
    expect(translateTagKey('payment:bitcoin')).toBeUndefined();
    expect(translateTagKey('healthcare:counselling')).toBeUndefined();
  });
});

describe('formatOsmDate', () => {
  it('writes OSM dates the Norwegian way', () => {
    expect(formatOsmDate('2025-03-01')).toBe('1. mars 2025');
    expect(formatOsmDate('2024-11')).toBe('november 2024');
    expect(formatOsmDate('1998')).toBeUndefined();
  });
});

describe('formatCuisine', () => {
  it('names common dishes in Norwegian and keeps unknown ones', () => {
    expect(formatCuisine('italian;pizza')).toBe('Italiensk, pizza');
    expect(formatCuisine('coffee_shop')).toBe('Kaffebar');
    expect(formatCuisine('poke_bowl')).toBe('Poke bowl');
  });
});

describe('translateTagValue', () => {
  it('translates booleans, access, dates, hours and place types', () => {
    expect(translateTagValue('toilets', 'yes')).toBe('Ja');
    expect(translateTagValue('wheelchair', 'designated')).toBe('Tilrettelagt');
    expect(translateTagValue('check_date', '2025-03-01')).toBe('1. mars 2025');
    expect(translateTagValue('opening_hours', 'Mo-Su 10:00-20:00')).toBe('man.–søn. 10:00–20:00');
    expect(translateTagValue('healthcare', 'pharmacy')).toBe('Apotek');
  });

  it('keeps free text, numbers and addresses, and gives up on unknown tokens', () => {
    expect(translateTagValue('website', 'https://example.no/a_b')).toBe('https://example.no/a_b');
    expect(translateTagValue('description', 'Fin kafé')).toBe('Fin kafé');
    expect(translateTagValue('ele', '12')).toBe('12');
    expect(translateTagValue('roof:shape', 'gabled')).toBeUndefined();
  });
});
