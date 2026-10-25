import { describe, expect, it } from 'vitest';
import { formatKm, formatLatLng, formatMinutes, formatMeasuredArea, formatMeasuredDistance, formatHeight, formatMetres } from './format';

/** Intl may use a narrow or regular no-break space; compare on plain spaces. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('formatKm', () => {
  it('uses a Norwegian decimal comma and drops to metres under a kilometre', () => {
    expect(plain(formatKm(1234))).toBe('1,2 km');
    expect(plain(formatKm(850))).toBe('850 m');
    expect(plain(formatKm(12000))).toBe('12 km');
  });
  it('is empty for nothing to show', () => {
    expect(formatKm(0)).toBe('');
    expect(formatKm(undefined)).toBe('');
    expect(formatKm(Number.NaN)).toBe('');
  });
});

describe('formatMinutes', () => {
  it('rounds to whole minutes and spells out hours', () => {
    expect(formatMinutes(12 * 60000)).toBe('12 min');
    expect(formatMinutes(95 * 60000)).toBe('1 t 35 min');
    expect(formatMinutes(120 * 60000)).toBe('2 t');
    expect(formatMinutes(20 * 1000)).toBe('under 1 min');
  });
  it('is empty for nothing to show', () => {
    expect(formatMinutes(0)).toBe('');
    expect(formatMinutes(undefined)).toBe('');
  });
});

describe('measurement formatters', () => {
  it('formats distances with the right unit and precision', () => {
    expect(plain(formatMeasuredDistance(12.34))).toBe('12,3 m');
    expect(plain(formatMeasuredDistance(1250))).toBe('1,25 km');
  });
  it('formats areas in m² or km², never hectares', () => {
    expect(plain(formatMeasuredArea(250))).toBe('250 m²');
    expect(plain(formatMeasuredArea(250.54))).toBe('250,5 m²');
    // The range that used to read "1,25 ha", in whole square metres.
    expect(plain(formatMeasuredArea(12500.4))).toBe('12 500 m²');
    expect(plain(formatMeasuredArea(999_999))).toBe('999 999 m²');
    expect(plain(formatMeasuredArea(1_000_000))).toBe('1 km²');
    expect(plain(formatMeasuredArea(2_500_000))).toBe('2,5 km²');
  });
});

describe('formatLatLng', () => {
  it('reads latitude first with a Norwegian comma and hemisphere letters', () => {
    expect(plain(formatLatLng(59.913789, 10.744589))).toBe('59,91379° N, 10,74459° Ø');
    expect(plain(formatLatLng(-33.8688, -151.2093))).toBe('33,86880° S, 151,20930° V');
  });
});

describe('route detail numbers', () => {
  it('formats metres and heights in whole, grouped numbers', () => {
    expect(plain(formatMetres(64.3))).toBe('64 m');
    expect(plain(formatMetres(1240))).toBe('1 240 m');
    expect(plain(formatHeight(41.2))).toBe('41 moh.');
  });
});
