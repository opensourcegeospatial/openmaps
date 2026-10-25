import type { DetailKey, DetailValue } from './graphhopper';

/** The details shown as shares of the route (road_environment becomes the crossings line). */
export type ShareKey = Exclude<DetailKey, 'road_environment'>;

/** Missing data: null, or GraphHopper's "missing" (an untagged way). */
export const UNKNOWN_LABEL = 'Ukjent';
/** There is a value, but not one we name (also: every category under 2 %). */
export const OTHER_LABEL = 'Annet';

export const DETAIL_TITLES: Record<ShareKey, string> = {
  surface: 'Underlag',
  road_class: 'Veitype',
  max_speed: 'Fartsgrense'
};

const SURFACE: Record<string, string> = {
  asphalt: 'Asfalt',
  paved: 'Fast dekke',
  concrete: 'Betong',
  paving_stones: 'Belegningsstein',
  sett: 'Brostein',
  cobblestone: 'Brostein',
  compacted: 'Komprimert grus',
  fine_gravel: 'Fin grus',
  gravel: 'Grus',
  unpaved: 'Uten fast dekke',
  dirt: 'Jord',
  ground: 'Jord',
  grass: 'Gress',
  sand: 'Sand',
  wood: 'Tre'
};

// OSM's classes described plainly; they do not map reliably onto Statens
// vegvesen's europavei / riksvei / fylkesvei, so those words are not used.
const ROAD_CLASS: Record<string, string> = {
  motorway: 'Motorvei',
  trunk: 'Hovedvei',
  primary: 'Hovedvei',
  secondary: 'Samlevei',
  tertiary: 'Samlevei',
  residential: 'Boliggate',
  living_street: 'Gatetun',
  service: 'Adkomstvei',
  unclassified: 'Mindre vei',
  track: 'Traktorvei',
  cycleway: 'Sykkelvei',
  footway: 'Gangvei',
  pedestrian: 'Gågate',
  path: 'Sti',
  steps: 'Trapp'
};

export function detailLabel(key: ShareKey, value: DetailValue): string {
  if (value === null) return UNKNOWN_LABEL;
  // GraphHopper's Surface encoded value sends "missing" for an untagged way
  // (other details use null instead); either way means the same "no data".
  if (typeof value === 'string' && value.toLowerCase() === 'missing') return UNKNOWN_LABEL;
  if (key === 'max_speed') {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? `${Math.round(value)} km/t`
      : UNKNOWN_LABEL;
  }
  const table = key === 'surface' ? SURFACE : ROAD_CLASS;
  return typeof value === 'string' ? (table[value.toLowerCase()] ?? OTHER_LABEL) : OTHER_LABEL;
}

export type CrossingKind = 'ferry' | 'tunnel' | 'bridge';

const CROSSING_WORDS: Record<CrossingKind, [string, string]> = {
  ferry: ['ferje', 'ferjer'],
  tunnel: ['tunnel', 'tunneler'],
  bridge: ['bru', 'bruer']
};

/** "ingen ferje", "1 ferje", "2 ferjer". */
export function crossingPhrase(kind: CrossingKind, count: number): string {
  const [one, many] = CROSSING_WORDS[kind];
  if (count <= 0) return `ingen ${one}`;
  return `${count} ${count === 1 ? one : many}`;
}
