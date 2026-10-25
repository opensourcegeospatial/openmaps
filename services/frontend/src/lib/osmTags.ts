/**
 * Norwegian presentation of raw OSM tags that reach the UI: the "Flere
 * detaljer" list on the details card, opening hours, dates, wheelchair access
 * and cuisine. The UI is Norwegian-only, so a key or token value with no
 * Norwegian name returns undefined; callers then show the tag as a raw OSM tag
 * ("key = value") instead of a half-translated English label.
 */
import { translatePlaceType } from './placeTypes';

const TAG_KEY_LABELS: Record<string, string> = {
  operator: 'Drives av',
  'operator:type': 'Driftsform',
  brand: 'Kjede',
  description: 'Beskrivelse',
  note: 'Merknad',
  email: 'E-post',
  'contact:email': 'E-post',
  fax: 'Faks',
  'contact:fax': 'Faks',
  capacity: 'Kapasitet',
  level: 'Etasje',
  building: 'Bygning',
  'building:levels': 'Etasjer',
  'ref:bygningsnr': 'Bygningsnummer',
  ele: 'Høyde over havet',
  start_date: 'Åpnet',
  end_date: 'Stengt',
  check_date: 'Sist kontrollert',
  'survey:date': 'Sist kontrollert',
  internet_access: 'Internett',
  toilets: 'Toaletter',
  'toilets:wheelchair': 'Toalett for rullestol',
  changing_table: 'Stellebord',
  smoking: 'Røyking',
  outdoor_seating: 'Uteservering',
  indoor_seating: 'Innendørs servering',
  takeaway: 'Takeaway',
  delivery: 'Levering',
  drive_through: 'Drive-through',
  'wheelchair:description': 'Rullestol, merknad',
  dispensing: 'Reseptutlevering',
  healthcare: 'Helsetjeneste',
  amenity: 'Type',
  shop: 'Butikk',
  tourism: 'Turisme',
  leisure: 'Fritid',
  office: 'Kontor',
  religion: 'Religion',
  denomination: 'Trossamfunn',
  official_name: 'Offisielt navn',
  alt_name: 'Også kjent som',
  short_name: 'Kortnavn',
  old_name: 'Tidligere navn',
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
  source: 'Kilde',
  fee: 'Avgift',
  parking: 'Parkering',
  layer: 'Lag',
  ref: 'Referanse',
  'opening_hours:covid19': 'Åpningstider under covid-19'
};

const NAMESPACE_LABELS: Record<string, string> = {
  payment: 'Betaling',
  diet: 'Kosthold',
  name: 'Navn'
};

/** Names for the tail of a namespaced key, e.g. "payment:cash" gives "kontant". */
const TAIL_LABELS: Record<string, string> = {
  cash: 'kontant',
  coins: 'mynter',
  notes: 'sedler',
  cards: 'kort',
  debit_cards: 'debetkort',
  credit_cards: 'kredittkort',
  contactless: 'kontaktløst',
  visa: 'Visa',
  mastercard: 'Mastercard',
  vipps: 'Vipps',
  invoice: 'faktura',
  vegetarian: 'vegetarisk',
  vegan: 'vegansk',
  gluten_free: 'glutenfritt',
  lactose_free: 'laktosefritt',
  halal: 'halal',
  kosher: 'kosher'
};

const VALUE_LABELS: Record<string, string> = {
  yes: 'Ja',
  no: 'Nei',
  only: 'Kun',
  limited: 'Begrenset',
  designated: 'Tilrettelagt',
  wlan: 'Trådløst nett',
  wired: 'Kablet',
  terminal: 'Terminal',
  free: 'Gratis',
  customers: 'For kunder',
  private: 'Privat',
  public: 'Offentlig',
  permissive: 'Tillatt',
  outside: 'Utendørs',
  indoor: 'Innendørs',
  separate: 'Egen',
  unknown: 'Ukjent'
};

const CUISINE_LABELS: Record<string, string> = {
  coffee_shop: 'kaffebar',
  pizza: 'pizza',
  burger: 'burger',
  kebab: 'kebab',
  sushi: 'sushi',
  italian: 'italiensk',
  chinese: 'kinesisk',
  indian: 'indisk',
  thai: 'thailandsk',
  japanese: 'japansk',
  vietnamese: 'vietnamesisk',
  korean: 'koreansk',
  mexican: 'meksikansk',
  french: 'fransk',
  greek: 'gresk',
  turkish: 'tyrkisk',
  lebanese: 'libanesisk',
  spanish: 'spansk',
  american: 'amerikansk',
  asian: 'asiatisk',
  norwegian: 'norsk',
  regional: 'lokal',
  seafood: 'sjømat',
  fish: 'fisk',
  steak_house: 'biff',
  chicken: 'kylling',
  noodle: 'nudler',
  sandwich: 'smørbrød',
  breakfast: 'frokost',
  ice_cream: 'iskrem',
  vegetarian: 'vegetarisk',
  vegan: 'vegansk',
  tapas: 'tapas',
  crepe: 'crêpes',
  cake: 'kaker'
};

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const isToken = (value: string): boolean => /^[a-z][a-z0-9_]*$/.test(value);

/** Norwegian label for an OSM tag key; undefined when there is none. */
export function translateTagKey(key: string): string | undefined {
  const known = TAG_KEY_LABELS[key];
  if (known) return known;
  const colon = key.indexOf(':');
  if (colon <= 0) return undefined;
  const namespace = NAMESPACE_LABELS[key.slice(0, colon)];
  const tail = key.slice(colon + 1);
  if (!namespace) return undefined;
  if (key.startsWith('name:')) return `${namespace}, ${tail}`;
  const tailLabel = TAIL_LABELS[tail];
  return tailLabel ? `${namespace}, ${tailLabel}` : undefined;
}

/** An OSM date ("2025-03-01", "2025-03") in Norwegian; undefined for anything else. */
export function formatOsmDate(value: string): string | undefined {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    return new Intl.DateTimeFormat('nb-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(date);
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
    return new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  }
  return undefined;
}

/** OSM `cuisine` ("italian;pizza") in Norwegian; unknown dishes keep their name. */
export function formatCuisine(value: string): string {
  const parts = value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => CUISINE_LABELS[part.toLowerCase()] ?? part.replace(/_/g, ' '));
  return capitalize(parts.join(', '));
}

/**
 * Norwegian presentation of a tag value. Free text, numbers and addresses are
 * returned as they are; a plain OSM token with no Norwegian name returns
 * undefined, so the caller can show the tag raw.
 */
export function translateTagValue(key: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (key.startsWith('opening_hours')) return formatOpeningHours(trimmed);
  const date = formatOsmDate(trimmed);
  if (date) return date;
  if (key === 'cuisine') return formatCuisine(trimmed);
  const known = VALUE_LABELS[trimmed.toLowerCase()];
  if (known) return known;
  if (!isToken(trimmed)) return trimmed;
  return translatePlaceType(trimmed);
}

const DAY_LABELS: Record<string, string> = {
  Mo: 'man.',
  Tu: 'tir.',
  We: 'ons.',
  Th: 'tor.',
  Fr: 'fre.',
  Sa: 'lør.',
  Su: 'søn.',
  PH: 'helligdager',
  SH: 'skoleferie'
};

/**
 * The common OSM `opening_hours` forms in Norwegian: day codes, "off",
 * "24/7", rule separators and typographic ranges. Syntax this does not
 * understand passes through unchanged rather than being dropped.
 */
export function formatOpeningHours(raw: string): string {
  const value = raw.trim();
  if (!value) return raw;
  if (value === '24/7') return 'Døgnåpent';
  return value
    .split(';')
    .map((rule) =>
      rule
        .trim()
        .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b/g, (day) => DAY_LABELS[day] ?? day)
        .replace(/\b(off|closed)\b/gi, 'stengt')
        .replace(/(\S)-(\S)/g, '$1–$2')
    )
    .filter((rule) => rule.length > 0)
    .join(' · ');
}
