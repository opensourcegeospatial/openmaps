import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toUserMessage } from '../lib/errors';
import type { GeoJSONFeature } from '../lib/nominatim';
import { Geocode } from '../lib/nominatim';
import { searchOverpass, type OverpassGenerator, type OverpassSearchMeta } from '../lib/overpass';
import type { SearchMode } from '../lib/types';
import type { MapHandle } from './Map';
import { toFeature, type StoredPlace } from '../lib/places';
import { translatePlaceType } from '../lib/placeTypes';
import UndoNotice from './UndoNotice';
import { getPlaceTitle } from '../lib/featureDetails';
import { useRestingLabel } from '../hooks/useRestingLabel';

/** A place row's two lines: the name, then "type · locality". */
const rowText = (feature: GeoJSONFeature, category?: string) => {
  const { title, locality } = getPlaceTitle(feature);
  const type = translatePlaceType(category ?? feature.properties?.type);
  return { label: title, meta: [type, locality].filter(Boolean).join(' · ') || undefined };
};

/** The one error that is not the service's fault, so it offers no retry. */
const EMPTY_QUERY_MESSAGE = 'Skriv hva du leter etter først.';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  mode: SearchMode;
  mapRef: React.RefObject<MapHandle | null>;
  onSelect: (feature: GeoJSONFeature) => void;
  onHover?: (feature: GeoJSONFeature) => void;
  onUnhover?: () => void;
  onClear?: (detail: { source: string }) => void;
  onOverpassResults?: (features: GeoJSONFeature[], meta: OverpassSearchMeta) => void;
  /** "Mine steder", listed while the place-search field is empty and focused. */
  savedPlaces?: StoredPlace[];
  /** Recent searches, listed under Mine steder in the same situation. */
  recentPlaces?: StoredPlace[];
  /** Called by the "Tøm" button next to the recent searches. */
  onClearRecent?: () => void;
  /** Rendered at the start of the input row (the search-mode toggle), so it
   *  stays beside the input while the lists below open and close. */
  leading?: React.ReactNode;
  /** The search input, so the shell can hand focus back to it. */
  inputRef?: React.RefObject<HTMLInputElement>;
  /**
   * Show the line that teaches what the map itself answers. The shell turns it
   * off as soon as there is anything else on screen to read.
   */
  showMapHint?: boolean;
  /**
   * An area answer is on screen. The idle line ("Beskriv hva du leter etter")
   * is for a field with nothing asked yet, not for one whose answer stands.
   */
  answerShown?: boolean;
}

const StarIcon: React.FC = () => (
  <svg className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
  </svg>
);

const ClockIcon: React.FC = () => (
  <svg className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
  </svg>
);

const PinIcon: React.FC = () => (
  <svg className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

interface PlaceOptionProps {
  id: string;
  active: boolean;
  icon: 'pin' | 'star' | 'clock';
  label: string;
  meta?: string;
  ariaLabel?: string;
  onPick: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}

/**
 * One place in the field's listbox: a place found, a saved place or a recent
 * search. Options are not tab stops; the input keeps focus and the arrow keys
 * move the highlight (aria-activedescendant), drawn as the inset teal ring.
 */
const PlaceOption: React.FC<PlaceOptionProps> = ({
  id,
  active,
  icon,
  label,
  meta,
  ariaLabel,
  onPick,
  onEnter,
  onLeave
}: PlaceOptionProps) => (
  <button
    id={id}
    type="button"
    role="option"
    aria-selected={active}
    aria-label={ariaLabel}
    tabIndex={-1}
    onClick={onPick}
    // Keep the input focused while the option is clicked: without this the
    // blur closes the list before the click lands (Safari never moves focus to
    // a clicked button).
    onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()}
    onMouseEnter={onEnter}
    onMouseLeave={onLeave}
    className={`flex w-full items-start gap-2.5 border-b border-border-subtle px-4 py-2.5 text-left transition last:border-none hover:bg-surface-hover focus:outline-none ${
      active ? 'bg-surface-hover ring-2 ring-inset ring-base-default' : ''
    }`}
  >
    {icon === 'star' ? <StarIcon /> : icon === 'clock' ? <ClockIcon /> : <PinIcon />}
    <div className="min-w-0">
      <p className="truncate text-sm text-text-default">{label}</p>
      {meta && <p className="truncate text-xs text-text-subtle">{meta}</p>}
    </div>
  </button>
);

const SearchField: React.FC<SearchFieldProps> = (props: SearchFieldProps) => {
  const {
    value,
    onChange,
    placeholder,
    mode,
    mapRef,
    onSelect,
    onHover,
    onUnhover,
    onClear,
    onOverpassResults,
    savedPlaces = [],
    recentPlaces = [],
    onClearRecent,
    leading,
    inputRef,
    showMapHint = false,
    answerShown = false
  } = props;
  const [results, setResults] = useState<GeoJSONFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True once a place search for the current text has completed, so an empty
  // result can say so instead of showing nothing.
  const [searched, setSearched] = useState(false);
  // Bumped by "Prøv igjen" (or Enter) after a failed place search: the same
  // text searches again.
  const [retryToken, setRetryToken] = useState(0);
  // The last area-search query that came back with nothing, so the card can
  // say so instead of returning to its idle hint after a long wait.
  const [emptyArea, setEmptyArea] = useState<{ query: string; generator?: OverpassGenerator } | null>(null);
  // How many hits the last area search found for the current text; the idle
  // hint steps aside once there is an answer.
  // The last area answer's size and question, for the status line.
  const [areaHits, setAreaHits] = useState<{ count: number; query: string } | null>(null);
  // "Focus within" for the whole field, so the place lists stay open while
  // focus moves from the input to one of their rows.
  const [focused, setFocused] = useState(false);
  // The place last picked into the field: its long name, and the short name
  // the field reads by at rest while that long name is still its text.
  const [picked, setPicked] = useState<{ name: string; label: string } | null>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const fieldRef = inputRef ?? localInputRef;
  const resting = useRestingLabel(value, picked && value === picked.name ? picked.label : undefined, fieldRef);
  // Keyboard highlight in the listbox under the field (-1 = none).
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const suppressNextSearch = useRef(false);
  const requestIdRef = useRef(0);
  // In-flight Overpass search (can take minutes); cancelled on clear, mode
  // switch and unmount so a stale result never opens the results panel.
  const overpassAbortRef = useRef<AbortController | null>(null);

  const cancelOverpassSearch = () => {
    overpassAbortRef.current?.abort();
    overpassAbortRef.current = null;
  };

  useEffect(() => cancelOverpassSearch, []);

  const trimmedValue = value.trim();

  useEffect(() => {
    if (mode !== 'nominatim') {
      setResults([]);
      setError(null);
      // A new query (or a mode switch) withdraws the "no hits" verdict.
      setEmptyArea(null);
      setAreaHits(null);
      return;
    }
    // Switching back to place search abandons any running Overpass search.
    cancelOverpassSearch();
    setLoading(false);

    if (suppressNextSearch.current) {
      suppressNextSearch.current = false;
      return;
    }

    if (!trimmedValue) {
      setResults([]);
      setError(null);
      setSearched(false);
      setEmptyArea(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setSearched(false);
    setEmptyArea(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        const features = await Geocode(trimmedValue, {
          viewbox: mapRef.current?.getBounds() ?? null
        });
        if (requestIdRef.current === requestId) {
          setResults(features);
          setSearched(true);
        }
      } catch (err) {
        if (requestIdRef.current === requestId) {
          setError(toUserMessage(err, 'Søket kunne ikke utføres.'));
          setResults([]);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [mode, trimmedValue, mapRef, retryToken]);

  const handleSelect = (feature: GeoJSONFeature) => {
    suppressNextSearch.current = true;
    setResults([]);
    setSearched(false);
    setEmptyArea(null);
    onSelect(feature);
    const displayName = feature?.properties?.display_name;
    if (displayName && typeof displayName === 'string') {
      setPicked({ name: displayName, label: getPlaceTitle(feature).title });
      onChange(displayName);
    }
  };

  const handlePickPlace = (place: StoredPlace) => {
    handleSelect(toFeature(place));
  };

  const handleFocusWithin = () => {
    setFocused(true);
  };

  // A pointer press on another rail element (the "Veibeskrivelse" button,
  // the panel below) must not collapse the lists before its click lands: the
  // collapse would shift the element up and lose the click. Such a press
  // defers the close to the click (or to the end of the press when no click
  // comes); every other focus loss closes the lists at once.
  const deferCloseRef = useRef(false);
  const handleBlurWithin = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && wrapperRef.current?.contains(next)) return;
    if (deferCloseRef.current) return;
    setFocused(false);
  };

  useEffect(() => {
    if (!focused) return;
    const wrapper = wrapperRef.current;
    const rail = wrapper?.closest('[data-rail]') ?? null;
    const inside = (target: EventTarget | null, node: Element | null | undefined) =>
      Boolean(node && target instanceof Node && node.contains(target));
    const close = () => {
      deferCloseRef.current = false;
      setFocused(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (inside(event.target, wrapper)) return;
      if (inside(event.target, rail)) {
        deferCloseRef.current = true;
        return;
      }
      close();
    };
    const onClick = (event: MouseEvent) => {
      if (inside(event.target, wrapper)) return;
      close();
    };
    const onPointerUp = () => {
      if (!deferCloseRef.current) return;
      // The click, if any, dispatches right after this; a press that ends
      // without one (dragged away) still closes.
      window.setTimeout(() => {
        if (deferCloseRef.current) close();
      }, 0);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [focused]);

  const handleClear = () => {
    suppressNextSearch.current = true;
    cancelOverpassSearch();
    setLoading(false);
    setResults([]);
    setSearched(false);
    setEmptyArea(null);
    setAreaHits(null);
    setError(null);
    onChange('');
    onClear?.({ source: 'searchField' });
  };

  const handleCancelOverpass = () => {
    cancelOverpassSearch();
    setLoading(false);
  };

  const handleOverpassSearch = async () => {
    if (!trimmedValue) {
      setError(EMPTY_QUERY_MESSAGE);
      return;
    }

    const bounds = mapRef.current?.getBounds();
    if (!bounds) {
      setError('Kartet er ikke klart ennå. Prøv igjen om et øyeblikk.');
      return;
    }

    cancelOverpassSearch();
    const controller = new AbortController();
    overpassAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const bbox: [number, number, number, number] = [bounds.west, bounds.south, bounds.east, bounds.north];
      const { features, generator, overpassQuery } = await searchOverpass(trimmedValue, bbox, controller.signal);
      if (controller.signal.aborted) return;
      onOverpassResults?.(features, { query: trimmedValue, generator, overpassQuery, bbox });
      setEmptyArea(features.length === 0 ? { query: trimmedValue, generator } : null);
      setAreaHits({ count: features.length, query: trimmedValue });
      setResults([]);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(toUserMessage(err, 'Søket i området kunne ikke utføres.'));
      setResults([]);
    } finally {
      if (overpassAbortRef.current === controller) {
        overpassAbortRef.current = null;
        setLoading(false);
      }
    }
  };

  const canClear = useMemo(() => Boolean(value.length), [value.length]);
  const inputId = React.useId();
  const listboxId = React.useId();
  const savedHeadingId = React.useId();
  const recentHeadingId = React.useId();
  const showPlaces =
    mode === 'nominatim' &&
    focused &&
    trimmedValue === '' &&
    (savedPlaces.length > 0 || recentPlaces.length > 0);

  // One keyboard model for picking a place, shared with the route fields: the
  // input is a combobox, and everything listed under it (the places found, or
  // the saved and recent places) is one listbox of options. The arrow keys
  // move the highlight, Enter picks, Escape closes, and Tab leaves the field
  // instead of walking every row.
  const storedOptions = showPlaces ? [...savedPlaces, ...recentPlaces] : [];
  const optionCount = results.length > 0 ? results.length : storedOptions.length;
  const listOpen = optionCount > 0;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    setActiveIndex(-1);
  }, [results, showPlaces]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listboxId]);

  const pickOption = (index: number) => {
    if (results.length > 0) {
      if (results[index]) handleSelect(results[index]);
      return;
    }
    if (storedOptions[index]) handlePickPlace(storedOptions[index]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && (listOpen || focused)) {
      // Escape puts the list away; the shell's Escape (panels) does not fire.
      e.preventDefault();
      e.stopPropagation();
      setResults([]);
      setFocused(false);
      setActiveIndex(-1);
      return;
    }
    if (mode === 'overpass') {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleOverpassSearch();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!listOpen) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) =>
        index < 0 ? (step === 1 ? 0 : optionCount - 1) : (index + step + optionCount) % optionCount
      );
    } else if (e.key === 'Enter') {
      // Enter takes the highlighted place, else the first place found, or
      // searches again after a failure.
      if (listOpen && activeIndex >= 0) {
        e.preventDefault();
        pickOption(activeIndex);
      } else if (results.length > 0) {
        e.preventDefault();
        handleSelect(results[0]);
      } else if (error) {
        e.preventDefault();
        setRetryToken((n) => n + 1);
      }
    }
  };

  return (
    <div ref={wrapperRef} className="relative" onFocus={handleFocusWithin} onBlur={handleBlurWithin}>
      <label htmlFor={inputId} className="sr-only">
        {mode === 'overpass' ? 'Hva finnes i kartutsnittet?' : 'Søk etter sted eller adresse'}
      </label>
      <div className="flex items-center">
        {leading}
        {/* The page's focus home: where focus goes when the control that had
            it is gone and nothing better is left (see ToastProvider). */}
        <input
          id={inputId}
          ref={fieldRef}
          data-focus-home=""
          type="search"
          {...resting.inputProps}
          placeholder={placeholder}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onChange(event.target.value)
          }
          onFocus={() => {
            resting.onFocus();
            setError(null);
          }}
          onBlur={resting.onBlur}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listboxId : undefined}
          aria-activedescendant={listOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          className="h-12 w-full text-ellipsis bg-transparent px-4 text-base text-text-default placeholder-text-subtle outline-none"
        />
        {resting.resting && (
          <span id={resting.descriptionId} className="sr-only">
            {value}
          </span>
        )}

        {/* In the area mode the wait is shown on "Søk" itself, the control
            that started it; a second spinner beside it said the same thing. */}
        {loading && mode !== 'overpass' && (
          <div
            className="mr-3 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-border-default border-t-base-default"
            aria-hidden="true"
          />
        )}

        {loading && mode === 'overpass' && (
          <button
            type="button"
            onClick={handleCancelOverpass}
            className="mr-2 shrink-0 rounded-lg border border-border-default px-3 py-1.5 text-sm font-medium text-text-default transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
          >
            Avbryt søk
          </button>
        )}

        {canClear && !loading && (
          <button
            type="button"
            onClick={handleClear}
            className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
            aria-label="Tøm søkefeltet"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {mode === 'overpass' && (
          // aria-disabled, not disabled: a disabled button drops the focus it
          // holds, and a keyboard user who pressed Søk was left on the page
          // for the whole search, up to a minute (critique run 12).
          //
          // Busy is said with words, not by fading. Run 13 dimmed the fill to
          // rescue the focus ring and left the label at 2.23:1 for the whole
          // minute — the one long wait in the product, on the control the eye
          // and the focus were both resting on, rendered as if broken
          // (critique run 16). The fill stays whole and the label says what is
          // happening; the spinner moved in from beside the field, so the wait
          // has one indicator, on what started it. No aria-busy: on a button it
          // lets a screen reader hold the old name, and the status line under
          // the field already says "Søker i kartutsnittet…".
          <button
            type="button"
            onClick={() => {
              if (!loading) void handleOverpassSearch();
            }}
            aria-disabled={loading || undefined}
            className="mr-2 flex shrink-0 items-center gap-2 rounded-lg bg-base-default px-4 py-1.5 text-sm font-medium text-base-contrast-default transition hover:bg-base-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default aria-disabled:cursor-not-allowed aria-disabled:hover:bg-base-default"
          >
            {loading && (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-base-contrast-default/40 border-t-base-contrast-default"
              />
            )}
            {loading ? 'Søker…' : 'Søk'}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-t border-border-subtle px-4 py-2 text-sm text-danger-text-default"
        >
          <span>{error}</span>
          {error !== EMPTY_QUERY_MESSAGE && (
            <button
              type="button"
              onClick={() => {
                if (mode === 'overpass') void handleOverpassSearch();
                else setRetryToken((n) => n + 1);
              }}
              className="shrink-0 rounded text-xs font-medium text-danger-text-default underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
            >
              Prøv igjen
            </button>
          )}
        </div>
      )}

      {mode === 'overpass' && !error && !loading && emptyArea && (
        <p role="status" className="border-t border-border-subtle px-4 py-2 text-sm text-text-subtle">
          {/* Only the bundled local model needs English; the others read Norwegian. */}
          {emptyArea.generator === 'byt5'
            ? `Ingen treff for «${emptyArea.query}» i kartutsnittet. Zoom ut, prøv et annet ord, eller skriv det på engelsk.`
            : `Ingen treff for «${emptyArea.query}» i kartutsnittet. Zoom ut, eller prøv et annet ord.`}
        </p>
      )}

      {mode === 'overpass' && !error && (loading || (!emptyArea && areaHits === null && !answerShown)) && (
        <p
          role={loading ? 'status' : undefined}
          className="border-t border-border-subtle px-4 py-2 text-xs text-text-subtle"
        >
          {loading
            ? 'Søker i kartutsnittet… Dette kan ta opptil et minutt.'
            : 'Beskriv hva du leter etter.'}
        </p>
      )}

      {mode === 'nominatim' && showMapHint && !error && !listOpen && !trimmedValue && (
        // The permanent teaching on the default screen: PRODUCT.md left
        // first-visit guidance open, and someone who opens this map twice a
        // year finds the search field and nothing else (critique run 7). A
        // second line pointing at the tools in the corners was removed at the
        // user's request (2026-09-23).
        <p className="border-t border-border-subtle px-4 py-2 text-xs text-text-subtle">
          Klikk i kartet for å se stedet eller adressen der.
        </p>
      )}

      {mode === 'nominatim' && searched && !loading && !error && trimmedValue !== '' && results.length === 0 && (
        <p role="status" className="border-t border-border-subtle px-4 py-2 text-sm text-text-subtle">
          Ingen steder funnet for «{trimmedValue}». Prøv et annet navn eller en adresse.
        </p>
      )}

      {/* Always mounted, so the count is announced when results arrive — an
          area search too, whose answer can take a minute and used to arrive in
          silence for a screen reader (critique run 12). "Ingen treff" has its
          own visible status line above. */}
      <p role="status" className="sr-only">
        {mode === 'nominatim' && searched && !loading && !error && results.length > 0
          ? `${results.length} treff`
          : mode === 'overpass' && !loading && !error && areaHits && areaHits.count > 0
            ? `${areaHits.count} treff for «${areaHits.query}»`
            : ''}
      </p>

      {listOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={results.length > 0 ? 'Steder funnet' : 'Mine steder og nylige søk'}
          className={`border-t border-border-default ${results.length > 0 ? '' : 'max-h-[60vh] overflow-y-auto'}`}
        >
          {results.length > 0 ? (
            results.map((feature: GeoJSONFeature, index: number) => {
              const osmId = feature.properties?.osm_id ?? feature.id ?? feature.properties?.place_id;
              return (
                <PlaceOption
                  key={osmId ?? index}
                  id={optionId(index)}
                  active={index === activeIndex}
                  icon="pin"
                  {...rowText(feature)}
                  // The full address stays the accessible name: the two lines are its short form.
                  ariaLabel={[feature.properties?.display_name, translatePlaceType(feature.properties?.type)]
                    .filter(Boolean)
                    .join(', ')}
                  onPick={() => handleSelect(feature)}
                  onEnter={() => onHover?.(feature)}
                  onLeave={() => onUnhover?.()}
                />
              );
            })
          ) : (
            <>
              {savedPlaces.length > 0 && (
                <div role="group" aria-labelledby={savedHeadingId}>
                  <div
                    id={savedHeadingId}
                    role="presentation"
                    className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-text-subtle"
                  >
                    Mine steder
                  </div>
                  {savedPlaces.map((place, index) => (
                    <PlaceOption
                      key={place.id}
                      id={optionId(index)}
                      active={index === activeIndex}
                      icon="star"
                      {...rowText(toFeature(place), place.category)}
                      ariaLabel={`Gå til ${place.name}`}
                      onPick={() => handlePickPlace(place)}
                    />
                  ))}
                </div>
              )}
              {recentPlaces.length > 0 && (
                <div role="group" aria-labelledby={recentHeadingId}>
                  <div
                    id={recentHeadingId}
                    role="presentation"
                    className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-text-subtle"
                  >
                    Nylige søk
                  </div>
                  {recentPlaces.map((place, index) => {
                    const optionIndex = savedPlaces.length + index;
                    return (
                      <PlaceOption
                        key={place.id}
                        id={optionId(optionIndex)}
                        active={optionIndex === activeIndex}
                        icon="clock"
                        {...rowText(toFeature(place), place.category)}
                        ariaLabel={`Gå til ${place.name}`}
                        onPick={() => handlePickPlace(place)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* What the lists under this field lost waits at its foot, where those
          lists are: a place removed from Mine steder, the cleared recent
          searches. Both outlive the panel opening and closing, so they are not
          tied to it — and neither is tied to the search mode, because a place
          is starred from its card, which the area search opens too (polish,
          critique run 15). */}
      <UndoNotice subject="saved-place" className="m-2" />
      <UndoNotice subject="recent-searches" className="m-2" />

      {/* Outside the listbox, which may hold only options: a plain button that
          Tab reaches after the field. */}
      {showPlaces && recentPlaces.length > 0 && onClearRecent && (
        <div className="flex justify-end border-t border-border-subtle px-4 py-1.5">
          <button
            type="button"
            onClick={onClearRecent}
            onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()}
            className="rounded text-xs text-text-subtle underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
          >
            Tøm nylige søk
          </button>
        </div>
      )}
    </div>
  );
};

export default SearchField;
