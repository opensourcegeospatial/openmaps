import { describe, it, expect } from 'vitest';
import { crossingPhrase, detailLabel, DETAIL_TITLES, OTHER_LABEL, UNKNOWN_LABEL } from './routeDetailLabels';

describe('detailLabel', () => {
  it('names surfaces and road classes in bokmål', () => {
    expect(detailLabel('surface', 'asphalt')).toBe('Asfalt');
    expect(detailLabel('surface', 'paving_stones')).toBe('Belegningsstein');
    expect(detailLabel('surface', 'gravel')).toBe('Grus');
    expect(detailLabel('road_class', 'cycleway')).toBe('Sykkelvei');
    expect(detailLabel('road_class', 'trunk')).toBe('Hovedvei');
    expect(detailLabel('road_class', 'primary')).toBe('Hovedvei');
  });

  it('reads speed limits as km/t', () => {
    expect(detailLabel('max_speed', 30)).toBe('30 km/t');
    expect(detailLabel('max_speed', 49.7)).toBe('50 km/t');
  });

  it('says Ukjent for missing data and Annet for values it does not name', () => {
    expect(detailLabel('surface', null)).toBe(UNKNOWN_LABEL);
    expect(detailLabel('max_speed', null)).toBe(UNKNOWN_LABEL);
    expect(detailLabel('surface', 'rocky_moon_dust')).toBe(OTHER_LABEL);
    expect(detailLabel('road_class', 'busway')).toBe(OTHER_LABEL);
  });

  it('says Ukjent for GraphHopper\'s "missing" surface value, any case, on any key', () => {
    expect(detailLabel('surface', 'missing')).toBe(UNKNOWN_LABEL);
    expect(detailLabel('surface', 'MISSING')).toBe(UNKNOWN_LABEL);
    expect(detailLabel('road_class', 'missing')).toBe(UNKNOWN_LABEL);
  });

  it('titles each detail', () => {
    expect(DETAIL_TITLES).toEqual({ surface: 'Underlag', road_class: 'Veitype', max_speed: 'Fartsgrense' });
  });
});

describe('crossingPhrase', () => {
  it('counts in singular, plural and none', () => {
    expect(crossingPhrase('ferry', 0)).toBe('ingen ferje');
    expect(crossingPhrase('ferry', 1)).toBe('1 ferje');
    expect(crossingPhrase('ferry', 2)).toBe('2 ferjer');
    expect(crossingPhrase('tunnel', 2)).toBe('2 tunneler');
    expect(crossingPhrase('bridge', 1)).toBe('1 bru');
    expect(crossingPhrase('bridge', 3)).toBe('3 bruer');
  });
});
