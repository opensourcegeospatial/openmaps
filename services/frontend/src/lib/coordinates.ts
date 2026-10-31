/**
 * Reads a position someone typed or pasted, whichever format it came in:
 * decimal degrees, degrees and minutes, degrees, minutes and seconds, UTM or
 * MGRS. Nobody says which format they hold, so the text decides, and numbers
 * that fit more than one place get one reading each for the person to choose
 * between. A wrong pin that looks right is the failure to avoid.
 *
 * Everything is taken as WGS84/EUREF89. The two agree to well within a metre
 * here; a value from an older datum such as ED50 lands about 200 m off.
 */

import type { Feature, Point } from 'geojson';
import { formatLatLng } from './format';
import type { GeoJSONFeature } from './nominatim';

export interface CoordinateReading {
  lat: number;
  lng: number;
  /** What this reading took the text to be, for the row's second line. */
  label: string;
}

export interface CoordinateParse {
  readings: CoordinateReading[];
  /** Why there are no readings; null when there are, or nothing was typed. */
  problem: string | null;
}

const NOT_RECOGNISED = 'Kjenner ikke igjen koordinatene. Prøv for eksempel 59,9139 10,7522.';
const BAD_LATITUDE = 'Breddegrad må være mellom −90 og 90.';
const BAD_LONGITUDE = 'Lengdegrad må være mellom −180 og 180.';
const BAD_MINUTES = 'Minutter og sekunder må være under 60.';
const BAD_ZONE = 'UTM-sonen må være mellom 1 og 60.';
const BAD_ZONE_LETTER = 'Nordverdien passer ikke med sonebokstaven.';
const BAD_SQUARE = 'Den MGRS-ruten finnes ikke i denne sonen.';

const refuse = (problem: string): CoordinateParse => ({ readings: [], problem });
const found = (...readings: CoordinateReading[]): CoordinateParse => ({ readings, problem: null });

// --- UTM: the Krüger series to the third order, good to a few millimetres ---

const SEMI_MAJOR_AXIS = 6378137;
const FLATTENING = 1 / 298.257223563;
const SCALE = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING_SOUTH = 10000000;

const n = FLATTENING / (2 - FLATTENING);
const RECTIFYING_RADIUS = (SEMI_MAJOR_AXIS / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
const ALPHA = [n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16, (13 * n ** 2) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
const BETA = [n / 2 - (2 * n ** 2) / 3 + (37 * n ** 3) / 96, n ** 2 / 48 + n ** 3 / 15, (17 * n ** 3) / 480];
const DELTA = [2 * n - (2 * n ** 2) / 3 - 2 * n ** 3, (7 * n ** 2) / 3 - (8 * n ** 3) / 5, (56 * n ** 3) / 15];

const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function utmToLatLng(zone: number, southern: boolean, easting: number, northing: number) {
  const xi = (northing - (southern ? FALSE_NORTHING_SOUTH : 0)) / (SCALE * RECTIFYING_RADIUS);
  const eta = (easting - FALSE_EASTING) / (SCALE * RECTIFYING_RADIUS);
  let xiPrime = xi;
  let etaPrime = eta;
  BETA.forEach((beta, index) => {
    const order = 2 * (index + 1);
    xiPrime -= beta * Math.sin(order * xi) * Math.cosh(order * eta);
    etaPrime -= beta * Math.cos(order * xi) * Math.sinh(order * eta);
  });
  const chi = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  const latitude = DELTA.reduce((sum, delta, index) => sum + delta * Math.sin(2 * (index + 1) * chi), chi);
  const longitude = Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime));
  return { lat: toDegrees(latitude), lng: zone * 6 - 183 + toDegrees(longitude) };
}

/** The northing of a latitude on the zone's central meridian, its lowest there. */
function northingAt(latitude: number): number {
  const sine = Math.sin(toRadians(latitude));
  const eccentricityTerm = (2 * Math.sqrt(n)) / (1 + n);
  const xiPrime = Math.atan(Math.sinh(Math.atanh(sine) - eccentricityTerm * Math.atanh(eccentricityTerm * sine)));
  const meridional = ALPHA.reduce((sum, alpha, index) => sum + alpha * Math.sin(2 * (index + 1) * xiPrime), xiPrime);
  return SCALE * RECTIFYING_RADIUS * meridional + (latitude < 0 ? FALSE_NORTHING_SOUTH : 0);
}

const BAND_LETTERS = 'CDEFGHJKLMNPQRSTUVWX';

function bandOf(letter: string) {
  const index = BAND_LETTERS.indexOf(letter);
  if (index < 0) return null;
  const south = -80 + index * 8;
  return { south, north: south + (letter === 'X' ? 12 : 8), southern: south < 0 };
}

type Band = NonNullable<ReturnType<typeof bandOf>>;

// A shortened MGRS square can reach past its band, so the check leaves room.
const insideBand = (latitude: number, band: Band) => latitude >= band.south - 0.5 && latitude <= band.north + 0.5;

// --- MGRS ---

const MGRS_PATTERN = /^(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])\s*([A-HJ-NP-V])\s*(\d+)?\s*(\d+)?$/;
const MGRS_COLUMNS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const MGRS_ROWS = 'ABCDEFGHJKLMNPQRSTUV';
const SQUARE_SIZE = 100000;
const ROW_CYCLE = 2000000;

function readMgrs(text: string): CoordinateParse | null {
  const match = MGRS_PATTERN.exec(text);
  if (!match) return null;
  const [, zoneText, bandLetter, columnLetter, rowLetter, first = '', second] = match;
  const digits = second === undefined ? first : first + second;
  const evenBlocks = second === undefined ? first.length % 2 === 0 : first.length === second.length;
  if (!evenBlocks || digits.length > 10) return refuse(NOT_RECOGNISED);

  const zone = Number(zoneText);
  const band = bandOf(bandLetter) as Band; // The pattern only lets band letters through.
  if (zone < 1 || zone > 60) return refuse(BAD_ZONE);
  const column = MGRS_COLUMNS[(zone - 1) % 3].indexOf(columnLetter);
  if (column < 0) return refuse(BAD_SQUARE);

  // Rows repeat every 2000 km, and even zones start their count at F. The band
  // says which repeat is meant.
  const row = (MGRS_ROWS.indexOf(rowLetter) + (zone % 2 === 0 ? 15 : 0)) % MGRS_ROWS.length;
  const perAxis = digits.length / 2;
  const precision = 10 ** (5 - perAxis);
  // A shortened reference names a whole square, so the pin goes to its middle:
  // the closest it can be to wherever in the square was meant.
  const middle = perAxis < 5 ? precision / 2 : 0;
  const offset = (part: string) => (part ? Number(part) * precision : 0) + middle;
  const easting = (column + 1) * SQUARE_SIZE + offset(digits.slice(0, perAxis));
  let northing = row * SQUARE_SIZE + offset(digits.slice(perAxis));
  const lowest = northingAt(band.south);
  while (northing < lowest) northing += ROW_CYCLE;

  const position = utmToLatLng(zone, band.southern, easting, northing);
  if (!insideBand(position.lat, band)) return refuse(BAD_SQUARE);
  const square = `MGRS ${zone}${bandLetter} ${columnLetter}${rowLetter}`;
  if (perAxis === 5) return found({ ...position, label: square });
  const size = precision >= 1000 ? `${precision / 1000} km` : `${precision} m`;
  return found({ ...position, label: `${square}, rute på ${size}` });
}

// --- Everything else is read from tokens ---

type Mark = '°' | "'" | '"';
type Token =
  | { type: 'number'; value: number; text: string }
  | { type: 'mark'; mark: Mark }
  | { type: 'word'; word: string };

const TOKEN_PATTERN = /\s+|[,;/=:]|(-?\d+(?:[.,]\d+)?)|([°'"])|([A-ZÆØÅ]+)/y;

function tokenise(text: string): Token[] | null {
  const tokens: Token[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  while (TOKEN_PATTERN.lastIndex < text.length) {
    const match = TOKEN_PATTERN.exec(text);
    if (!match) return null;
    if (match[1]) tokens.push({ type: 'number', value: Number(match[1].replace(',', '.')), text: match[1] });
    else if (match[2]) tokens.push({ type: 'mark', mark: match[2] as Mark });
    else if (match[3]) tokens.push({ type: 'word', word: match[3] });
  }
  // "59,10" has one comma and two numbers: nobody searches for a lone number.
  const only = tokens.length === 1 ? tokens[0] : null;
  if (only?.type === 'number' && only.text.includes(',')) {
    return only.text.split(',').map((part) => ({ type: 'number' as const, value: Number(part), text: part }));
  }
  return tokens;
}

// --- UTM ---

const EASTING_LABELS = new Set(['E', 'Ø', 'O', 'ØST', 'EAST']);
const NORTHING_LABELS = new Set(['N', 'NORD', 'NORTH']);
const LOWEST_EASTING = 100000;
const HIGHEST_EASTING = 999999;
// Norway's zones, the national one first: 33 is what national datasets use.
const NORWEGIAN_ZONES = [33, 32, 35];

const isEasting = (value: number) => value >= LOWEST_EASTING && value <= HIGHEST_EASTING;
const isNorthing = (value: number) => value >= 0 && value <= FALSE_NORTHING_SOUTH;

/** Two numbers, labelled before or after or not at all. */
function readEastingNorthing(tokens: Token[]): { easting: number; northing: number } | null {
  const shape = tokens.map((token) => token.type[0]).join('');
  if (!['nn', 'wnwn', 'nwnw'].includes(shape)) return null;
  const numbers = tokens.flatMap((token) => (token.type === 'number' ? [token.value] : []));
  const labels = tokens.flatMap((token) => (token.type === 'word' ? [token.word] : []));

  let [easting, northing] = numbers;
  if (labels.length === 2) {
    if (NORTHING_LABELS.has(labels[0]) && EASTING_LABELS.has(labels[1])) [northing, easting] = numbers;
    else if (!(EASTING_LABELS.has(labels[0]) && NORTHING_LABELS.has(labels[1]))) return null;
  } else if (!isEasting(easting) && isEasting(northing)) {
    // The order is not a convention people keep, but the sizes tell them apart.
    [northing, easting] = numbers;
  }
  return isEasting(easting) && isNorthing(northing) ? { easting, northing } : null;
}

function readUtm(tokens: Token[]): CoordinateParse | null {
  const zoneless = readEastingNorthing(tokens);
  if (zoneless) {
    return found(
      ...NORWEGIAN_ZONES.map((zone) => ({
        ...utmToLatLng(zone, false, zoneless.easting, zoneless.northing),
        label: `UTM sone ${zone}`
      }))
    );
  }

  const [first, second] = tokens;
  if (first?.type !== 'number' || !Number.isInteger(first.value) || first.value < 0 || first.value >= 100) return null;
  const zone = first.value;
  const zoneExists = zone >= 1 && zone <= 60;
  const zoned = readEastingNorthing(tokens.slice(1));
  if (zoned) {
    if (!zoneExists) return refuse(BAD_ZONE);
    return found({ ...utmToLatLng(zone, false, zoned.easting, zoned.northing), label: `UTM sone ${zone}` });
  }

  if (second?.type !== 'word') return null;
  const letter = second.word;
  const banded = readEastingNorthing(tokens.slice(2));
  const band = bandOf(letter);
  if (!banded || !band) return null;
  if (!zoneExists) return refuse(BAD_ZONE);
  const label = `UTM sone ${zone}${letter}`;
  const asBand = utmToLatLng(zone, band.southern, banded.easting, banded.northing);
  if (insideBand(asBand.lat, band) || letter === 'N') return found({ ...asBand, label });
  // "32N" and "56S" are also written to mean the hemisphere, and S is a band
  // north of the equator, so a northing outside band S means the south.
  if (letter === 'S') return found({ ...utmToLatLng(zone, true, banded.easting, banded.northing), label });
  return refuse(BAD_ZONE_LETTER);
}

// --- Degrees, with or without minutes and seconds ---

type Axis = 'lat' | 'lng';
type Hemisphere = 'N' | 'S' | 'E' | 'W';

interface Angle {
  axis?: Axis;
  hemisphere?: Hemisphere;
  parts: number[];
}

const HEMISPHERES: Record<string, Hemisphere> = {
  N: 'N',
  NORD: 'N',
  NORTH: 'N',
  S: 'S',
  SØR: 'S',
  SYD: 'S',
  SOUTH: 'S',
  E: 'E',
  Ø: 'E',
  O: 'E',
  ØST: 'E',
  EAST: 'E',
  W: 'W',
  V: 'W',
  VEST: 'W',
  WEST: 'W'
};

const AXES: Record<string, Axis> = {
  LAT: 'lat',
  LATITUDE: 'lat',
  BREDDE: 'lat',
  BREDDEGRAD: 'lat',
  LON: 'lng',
  LNG: 'lng',
  LONG: 'lng',
  LONGITUDE: 'lng',
  LENGDE: 'lng',
  LENGDEGRAD: 'lng'
};

const MARK_POSITION: Record<Mark, number> = { '°': 0, "'": 1, '"': 2 };

function readAngles(tokens: Token[]): Angle[] | null {
  const angles: Angle[] = [];
  let current: Angle = { parts: [] };
  const close = () => {
    if (current.parts.length > 0 || current.axis || current.hemisphere) angles.push(current);
    current = { parts: [] };
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'mark') return null;
    if (token.type === 'number') {
      const next = tokens[index + 1];
      if (next?.type === 'mark') {
        index += 1;
        // A degree sign begins the next angle; a mark out of order is no angle.
        if (next.mark === '°' && current.parts.length > 0) close();
        if (MARK_POSITION[next.mark] !== current.parts.length) return null;
      }
      current.parts.push(token.value);
      continue;
    }
    const axis = AXES[token.word];
    if (axis) {
      if (current.parts.length > 0) close();
      if (current.axis) return null;
      current.axis = axis;
      continue;
    }
    const hemisphere = HEMISPHERES[token.word];
    if (!hemisphere) return null;
    if (current.parts.length === 0) {
      if (current.hemisphere) return null;
      current.hemisphere = hemisphere;
    } else if (current.hemisphere) {
      // Already had its letter up front, so this one belongs to the next angle.
      close();
      current.hemisphere = hemisphere;
    } else {
      current.hemisphere = hemisphere;
      close();
    }
  }
  close();

  // Bare numbers run together: halve them, as long as they halve.
  const [only] = angles;
  if (angles.length === 1 && !only.axis && !only.hemisphere && [2, 4, 6].includes(only.parts.length)) {
    const half = only.parts.length / 2;
    return [{ parts: only.parts.slice(0, half) }, { parts: only.parts.slice(half) }];
  }
  return angles;
}

/** The angle in signed degrees, or why it is not one. */
function angleValue({ parts, hemisphere }: Angle): number | string {
  if (parts.length < 1 || parts.length > 3) return NOT_RECOGNISED;
  const [degrees, minutes = 0, seconds = 0] = parts;
  const wholeUnits = (parts.length < 2 || Number.isInteger(degrees)) && (parts.length < 3 || Number.isInteger(minutes));
  if (!wholeUnits || minutes < 0 || seconds < 0 || (degrees < 0 && hemisphere)) return NOT_RECOGNISED;
  if (minutes >= 60 || seconds >= 60) return BAD_MINUTES;
  const size = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  return degrees < 0 || hemisphere === 'S' || hemisphere === 'W' ? -size : size;
}

const FORMAT_LABELS = ['Desimalgrader', 'Grader og minutter', 'Grader, minutter og sekunder'];

const fitsLatitude = (value: number) => Math.abs(value) <= 90;
const fitsLongitude = (value: number) => Math.abs(value) <= 180;
// Past a full circle it was never meant as an angle, however out of range.
const couldBeAnAngle = (value: number) => Math.abs(value) <= 360;

const axisOf = ({ axis, hemisphere }: Angle): Axis | null | undefined => {
  const fromLetter = hemisphere ? (hemisphere === 'N' || hemisphere === 'S' ? 'lat' : 'lng') : undefined;
  if (axis && fromLetter && axis !== fromLetter) return null;
  return axis ?? fromLetter;
};

function readDegrees(tokens: Token[]): CoordinateParse {
  const angles = readAngles(tokens);
  if (!angles || angles.length !== 2) return refuse(NOT_RECOGNISED);
  const values = angles.map(angleValue);
  const failed = values.find((value) => typeof value === 'string');
  if (typeof failed === 'string') return refuse(failed);
  const [a, b] = values as number[];
  const format = FORMAT_LABELS[Math.max(angles[0].parts.length, angles[1].parts.length) - 1];

  const axisA = axisOf(angles[0]);
  const axisB = axisOf(angles[1]);
  if (axisA === null || axisB === null) return refuse(NOT_RECOGNISED);
  if (axisA || axisB) {
    // One named axis settles the other, unless both claim the same one.
    const aIsLatitude = axisA ? axisA === 'lat' : axisB === 'lng';
    if (axisA && axisB && axisA === axisB) return refuse(NOT_RECOGNISED);
    const [lat, lng] = aIsLatitude ? [a, b] : [b, a];
    if (!fitsLatitude(lat)) return refuse(BAD_LATITUDE);
    if (!fitsLongitude(lng)) return refuse(BAD_LONGITUDE);
    return found({ lat, lng, label: format });
  }

  if (!couldBeAnAngle(a) || !couldBeAnAngle(b)) return refuse(NOT_RECOGNISED);
  const latitudeFirst = fitsLatitude(a) && fitsLongitude(b);
  const longitudeFirst = fitsLatitude(b) && fitsLongitude(a);
  if (!latitudeFirst && !longitudeFirst) return refuse(fitsLongitude(a) && fitsLongitude(b) ? BAD_LATITUDE : BAD_LONGITUDE);
  if (latitudeFirst && longitudeFirst && a !== b) {
    return found(
      { lat: a, lng: b, label: 'Breddegrad først' },
      { lat: b, lng: a, label: 'Lengdegrad først' }
    );
  }
  if (latitudeFirst) return found({ lat: a, lng: b, label: format });
  return found({ lat: b, lng: a, label: 'Lengdegrad først' });
}

/** Same marks and signs however they were typed, and no words that say nothing. */
function normalise(input: string): string {
  return input
    .toUpperCase()
    .replace(/\b(?:UTM|MGRS|EUREF\s*89|ETRS\s*89|WGS\s*84|SONE|ZONE)/g, ' ')
    .replace(/[º˚]/g, '°')
    .replace(/[″”“]|''|′′/g, '"')
    .replace(/[′’‘´`]/g, "'")
    .replace(/[−–—]/g, '-')
    .trim();
}

export function parseCoordinates(input: string): CoordinateParse {
  const text = normalise(input);
  if (!text) return { readings: [], problem: null };
  const mgrs = readMgrs(text);
  if (mgrs) return mgrs;
  const tokens = tokenise(text);
  if (!tokens) return refuse(NOT_RECOGNISED);
  return readUtm(tokens) ?? readDegrees(tokens);
}

/** A reading as a place the search field can list and the map can show. */
export function readingToFeature({ lat, lng, label }: CoordinateReading): GeoJSONFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { display_name: formatLatLng(lat, lng), coordinate_reading: label }
  };
}

/**
 * Whether a feature stands for an exact position rather than a place: its name
 * is its own coordinates. Told by the name because that is what survives being
 * saved in Mine steder or Nylige søk.
 */
export function isCoordinateFeature(feature: GeoJSONFeature): feature is Feature<Point, GeoJSONFeature['properties']> {
  if (feature.geometry?.type !== 'Point') return false;
  const [lng, lat] = feature.geometry.coordinates;
  return feature.properties?.display_name === formatLatLng(lat, lng);
}
