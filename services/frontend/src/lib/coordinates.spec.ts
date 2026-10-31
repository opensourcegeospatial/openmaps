import { describe, expect, it } from 'vitest';
import { isCoordinateFeature, parseCoordinates, readingToFeature } from './coordinates';
import type { GeoJSONFeature } from './nominatim';

/**
 * Every expected position is written by hand or comes from pyproj and the
 * mgrs package, never from this module. Four decimals is about 5 m.
 */
const expectOneReading = (input: string, lat: number, lng: number, label?: string) => {
  const { readings, problem } = parseCoordinates(input);
  expect(problem).toBeNull();
  expect(readings).toHaveLength(1);
  expect(readings[0].lat).toBeCloseTo(lat, 4);
  expect(readings[0].lng).toBeCloseTo(lng, 4);
  if (label) expect(readings[0].label).toBe(label);
};

describe('parseCoordinates: nothing typed', () => {
  it.each(['', '   '])('asks nothing of %j', (input) => {
    expect(parseCoordinates(input)).toEqual({ readings: [], problem: null });
  });
});

describe('parseCoordinates: decimal degrees', () => {
  it.each([
    '59.9139, 10.7522',
    '59.9139 10.7522',
    '59.9139,10.7522',
    '59,9139 10,7522',
    '59,9139, 10,7522',
    '59,9139,10,7522',
    '59,9139;10,7522',
    '59.9139 / 10.7522',
    '  59.9139   10.7522  '
  ])('reads %j latitude first', (input) => {
    const { readings } = parseCoordinates(input);
    expect(readings[0].lat).toBeCloseTo(59.9139, 4);
    expect(readings[0].lng).toBeCloseTo(10.7522, 4);
    expect(readings[0].label).toBe('Breddegrad først');
  });

  it('takes a lone comma between whole numbers as the separator', () => {
    const { readings } = parseCoordinates('59,10');
    expect(readings[0]).toMatchObject({ lat: 59, lng: 10 });
  });

  it.each([
    '59.9139 N 10.7522 Ø',
    'N59.9139 E10.7522',
    '59,9139° N, 10,7522° Ø',
    '59.9139°N 10.7522°O',
    'n 59.9139 ø 10.7522',
    '59,9139 nord 10,7522 øst',
    '10.7522 Ø 59.9139 N',
    'lat: 59.9139, lon: 10.7522',
    'lng=10.7522 lat=59.9139',
    'breddegrad 59,9139 lengdegrad 10,7522'
  ])('needs only one reading when %j names its axes', (input) => {
    expectOneReading(input, 59.9139, 10.7522, 'Desimalgrader');
  });

  it.each([
    ['33.8688 S 151.2093 Ø', -33.8688, 151.2093],
    ['40.7128 N 74.006 V', 40.7128, -74.006],
    ['40.7128 N 74.006 W', 40.7128, -74.006],
    ['34,5 sør 58,4 vest', -34.5, -58.4]
  ])('turns south and west negative in %j', (input, lat, lng) => {
    expectOneReading(input, lat, lng);
  });

  it.each(['-33.8688, 151.2093', '−33,8688 151,2093'])('reads the sign in %j', (input) => {
    expectOneReading(input, -33.8688, 151.2093, 'Desimalgrader');
  });

  it('offers both orders when a pair fits either way, latitude first on top', () => {
    const { readings, problem } = parseCoordinates('10,7522 59,9139');
    expect(problem).toBeNull();
    expect(readings).toEqual([
      { lat: 10.7522, lng: 59.9139, label: 'Breddegrad først' },
      { lat: 59.9139, lng: 10.7522, label: 'Lengdegrad først' }
    ]);
  });

  it('offers one reading when the two orders are the same place', () => {
    expectOneReading('45 45', 45, 45);
  });

  it('keeps only latitude first when the second number cannot be a latitude', () => {
    expectOneReading('10.7 120.5', 10.7, 120.5, 'Desimalgrader');
  });

  it('says it swapped when the first number cannot be a latitude', () => {
    expectOneReading('120.5 10.7', 10.7, 120.5, 'Lengdegrad først');
  });

  it.each([
    ['59,9139 190,7522', 'Lengdegrad'],
    ['N 59 Ø 190', 'Lengdegrad'],
    ['120 130', 'Breddegrad'],
    ['N 95 Ø 10', 'Breddegrad']
  ])('names the impossible axis in %j', (input, axis) => {
    const { readings, problem } = parseCoordinates(input);
    expect(readings).toEqual([]);
    expect(problem).toContain(axis);
  });
});

describe('parseCoordinates: degrees, minutes and seconds', () => {
  const DMS = 'Grader, minutter og sekunder';

  it.each([
    `59°54'50"N 10°45'08"E`,
    `59°54'50"N, 10°45'08"Ø`,
    `59° 54' 50" N 10° 45' 8" E`,
    `N 59° 54′ 50″ Ø 10° 45′ 08″`,
    `59°54'50''N 10°45'08''E`,
    `59º54’50”N 10º45’08”E`,
    '59 54 50 N 10 45 8 E',
    'N59 54 50 E10 45 08',
    `10°45'08"Ø 59°54'50"N`
  ])('reads %j', (input) => {
    expectOneReading(input, 59.913889, 10.752222, DMS);
  });

  it('turns south negative', () => {
    expectOneReading(`33°52'08"S 151°12'33"E`, -33.868889, 151.209167);
  });

  it.each([`59°54'50" 10°45'08"`, '59 54 50 10 45 08'])('offers both orders for %j', (input) => {
    const { readings } = parseCoordinates(input);
    expect(readings).toHaveLength(2);
    expect(readings[0].lat).toBeCloseTo(59.913889, 4);
    expect(readings[0].label).toBe('Breddegrad først');
    expect(readings[1].lat).toBeCloseTo(10.752222, 4);
    expect(readings[1].label).toBe('Lengdegrad først');
  });

  it.each([`59°64'50"N 10°45'08"E`, `59°54'60"N 10°45'08"E`])('refuses minutes or seconds of 60 in %j', (input) => {
    const { readings, problem } = parseCoordinates(input);
    expect(readings).toEqual([]);
    expect(problem).toContain('under 60');
  });
});

describe('parseCoordinates: degrees and decimal minutes', () => {
  it.each([
    `59°54.834'N 10°45.132'E`,
    `59°54,834'N 10°45,132'Ø`,
    '59 54,834 N 10 45,132 Ø',
    'N59 54.834 E10 45.132'
  ])('reads %j', (input) => {
    expectOneReading(input, 59.9139, 10.7522, 'Grader og minutter');
  });

  it('offers both orders for four bare numbers', () => {
    const { readings } = parseCoordinates('59 54,834 10 45,132');
    expect(readings).toHaveLength(2);
    expect(readings[0].lat).toBeCloseTo(59.9139, 4);
    expect(readings[1].lat).toBeCloseTo(10.7522, 4);
  });
});

describe('parseCoordinates: UTM', () => {
  it.each([
    '32V 597980 6643119',
    '32 V 597980 6643119',
    '32v 597980 6643119',
    'UTM 32V 597980 6643119',
    '32V 597980E 6643119N',
    '32V Ø 597980 N 6643119',
    '32V N 6643119 Ø 597980',
    '32V 6643119 597980'
  ])('reads %j', (input) => {
    expectOneReading(input, 59.9139, 10.752202, 'UTM sone 32V');
  });

  it.each(['32 597980 6643119', 'EUREF89 UTM sone 32 Ø 597980 N 6643119'])('reads %j with no zone letter', (input) => {
    expectOneReading(input, 59.9139, 10.752202, 'UTM sone 32');
  });

  it.each(['UTM32 597980 6643119', 'sone32 597980 6643119', 'EUREF89 UTM32, Ø 597980, N 6643119'])(
    'reads %j with the word against the zone',
    (input) => {
      expectOneReading(input, 59.9139, 10.752202, 'UTM sone 32');
    }
  );

  it.each([
    ['Bergen, west of the usual zone', '32V 297354 6700648', 60.391297, 5.322102],
    ['Tromsø', '34W 420654 7728081', 69.649198, 18.955311],
    ['Longyearbyen', '33X 514279 8683355', 78.223196, 15.626712],
    ['just north of the equator', '32N 500000 55265', 0.5, 9],
    ['Sydney, south of the equator', '56H 334369 6250948', -33.868803, 151.209304]
  ])('reads %s', (_name, input, lat, lng) => {
    expectOneReading(input, lat, lng);
  });

  it('takes N as the northern hemisphere when the point is outside band N', () => {
    expectOneReading('32N 597980 6643119', 59.9139, 10.752202);
  });

  it('takes S as the southern hemisphere when the point is outside band S', () => {
    expectOneReading('56S 334369 6250948', -33.868803, 151.209304);
  });

  it.each(['597980 6643119', '6643119 597980', 'Ø 597980 N 6643119', '597980 Ø 6643119 N', '597980,6643119'])(
    'offers the Norwegian zones, national zone first, for %j',
    (input) => {
      const { readings, problem } = parseCoordinates(input);
      expect(problem).toBeNull();
      expect(readings.map((reading) => reading.label)).toEqual(['UTM sone 33', 'UTM sone 32', 'UTM sone 35']);
      expect(readings[0].lng).toBeCloseTo(16.752202, 4);
      expect(readings[1].lng).toBeCloseTo(10.752202, 4);
      expect(readings[2].lng).toBeCloseTo(28.752202, 4);
      readings.forEach((reading) => expect(reading.lat).toBeCloseTo(59.9139, 4));
    }
  );

  it('refuses a northing that does not fit the zone letter', () => {
    const { readings, problem } = parseCoordinates('32V 597980 4643119');
    expect(readings).toEqual([]);
    expect(problem).toContain('sonebokstaven');
  });

  it.each(['61V 597980 6643119', '0V 597980 6643119'])('refuses the zone in %j', (input) => {
    const { readings, problem } = parseCoordinates(input);
    expect(readings).toEqual([]);
    expect(problem).toContain('sonen');
  });
});

describe('parseCoordinates: MGRS', () => {
  it.each(['32VNM9798043119', '32V NM 97980 43119', '32vnm 97980 43119', '32VNM 9798043119'])('reads %j', (input) => {
    expectOneReading(input, 59.9139, 10.752202, 'MGRS 32V NM');
  });

  it.each([
    ['Bergen', '32VKN9735300648', 60.391297, 5.322102],
    ['Tromsø', '34WDC2065328081', 69.649198, 18.955311],
    ['Longyearbyen', '33XWG1427883355', 78.223196, 15.626712],
    ['just north of the equator', '32NNF0000055265', 0.5, 9],
    ['Sydney', '56HLH3436850948', -33.868803, 151.209304]
  ])('reads %s', (_name, input, lat, lng) => {
    expectOneReading(input, lat, lng);
  });

  it.each([
    ['32VNM 97 43', 59.917433, 10.743802, 'MGRS 32V NM, rute på 1 km'],
    ['32VNM 979 431', 59.914185, 10.75168, 'MGRS 32V NM, rute på 100 m'],
    ['32VNM', 59.984289, 9.896009, 'MGRS 32V NM, rute på 100 km']
  ])('puts the shortened %j at the middle of its square', (input, lat, lng, label) => {
    expectOneReading(input, lat, lng, label);
  });

  it.each(['32VNM 97 431', '32VNM975'])('does not recognise the uneven digits in %j', (input) => {
    const { readings, problem } = parseCoordinates(input);
    expect(readings).toEqual([]);
    expect(problem).toContain('Kjenner ikke igjen');
  });

  it.each([
    ['a column letter zone 32 does not have', '32VAM 97980 43119'],
    ['a row that lands outside band V', '32VNA 12345 12345']
  ])('refuses %s', (_name, input) => {
    const { readings, problem } = parseCoordinates(input);
    expect(readings).toEqual([]);
    expect(problem).toContain('MGRS');
  });
});

describe('parseCoordinates: not coordinates', () => {
  it.each([
    'rådhusplassen',
    'Storgata 12',
    '59.9139',
    '59 54 50',
    '1 2 3 4 5',
    'N 59 N 10',
    '59 N 10 S',
    '-59 N 10 Ø',
    '1000 6643119',
    '59.5 30 10 20'
  ])('points to an example for %j', (input) => {
    const { readings, problem } = parseCoordinates(input);
    expect(readings).toEqual([]);
    expect(problem).toContain('Kjenner ikke igjen');
  });
});

describe('readingToFeature', () => {
  it('is a point in GeoJSON order, named the way the app writes a position', () => {
    const feature = readingToFeature({ lat: 59.9139, lng: 10.7522, label: 'UTM sone 32V' });
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [10.7522, 59.9139] });
    expect(feature.properties?.display_name).toBe('59,91390° N, 10,75220° Ø');
    expect(feature.properties?.coordinate_reading).toBe('UTM sone 32V');
  });
});

describe('isCoordinateFeature', () => {
  const point = (display_name: string): GeoJSONFeature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
    properties: { display_name }
  });

  it('knows a position by its name, so one saved or recent counts too', () => {
    expect(isCoordinateFeature(point('59,91390° N, 10,75220° Ø'))).toBe(true);
  });

  it('leaves out a place at the same spot', () => {
    expect(isCoordinateFeature(point('Rådhusplassen 1, Oslo'))).toBe(false);
  });

  it('leaves out a name for some other spot', () => {
    expect(isCoordinateFeature(point('1,00000° N, 2,00000° Ø'))).toBe(false);
  });

  it('leaves out anything that is not a point', () => {
    const area: GeoJSONFeature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[10.7522, 59.9139], [10.8, 59.9]] },
      properties: { display_name: '59,91390° N, 10,75220° Ø' }
    };
    expect(isCoordinateFeature(area)).toBe(false);
  });
});
