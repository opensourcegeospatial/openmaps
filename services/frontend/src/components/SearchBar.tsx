import React, { useCallback, useRef, useState } from 'react';
import type { OverpassSearchMeta } from '../lib/overpass';
import type { GeoJSONFeature } from '../lib/nominatim';
import type { SearchMode } from '../lib/types';
import SearchField from './SearchField';
import type { MapHandle } from './Map';
import type { StoredPlace } from '../lib/places';

interface SearchBarProps {
  mapRef: React.RefObject<MapHandle | null>;
  onSelect: (feature: GeoJSONFeature) => void;
  onHover: (feature: GeoJSONFeature) => void;
  onUnhover: () => void;
  onClear: (detail: { source: string }) => void;
  onOverpassResults: (features: GeoJSONFeature[], meta: OverpassSearchMeta) => void;
  onModeChange?: (mode: SearchMode) => void;
  savedPlaces?: StoredPlace[];
  recentPlaces?: StoredPlace[];
  onClearRecent?: () => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Show the line teaching what the map answers (nothing else on screen). */
  showMapHint?: boolean;
  /**
   * The question an area answer on screen answers, while one stands. The area
   * field asks it again when its mode returns, and the idle hint stays away.
   */
  areaQuestion?: string;
}

const PinIcon = () => (
  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const GlobeIcon = () => (
  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

/**
 * Both search modes, always visible: the everyday "Steder" and the area search
 * "Hva finnes i kartutsnittet?". A toggle that named only the current mode hid the second
 * job from anyone who did not already know it existed.
 */
const MODES: { id: SearchMode; label: string; Icon: React.FC }[] = [
  { id: 'nominatim', label: 'Steder', Icon: PinIcon },
  { id: 'overpass', label: 'Hva finnes i kartutsnittet?', Icon: GlobeIcon }
];

const SearchBar: React.FC<SearchBarProps> = ({
  mapRef,
  onSelect,
  onHover,
  onUnhover,
  onClear,
  onOverpassResults,
  onModeChange,
  savedPlaces,
  recentPlaces,
  onClearRecent,
  inputRef,
  showMapHint,
  areaQuestion
}: SearchBarProps) => {
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('nominatim');
  const localInputRef = useRef<HTMLInputElement>(null);
  const fieldRef = inputRef ?? localInputRef;
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectMode = useCallback(
    (next: SearchMode) => {
      if (next === searchMode) return;
      setSearchMode(next);
      onModeChange?.(next);
      // Each mode asks a different question, so one mode's text never carries
      // into the other: a place name left in the area field would run into the
      // new query ("Osloapotek"). Place search starts empty; the area field
      // gets back the question its answer on screen answers, not whatever was
      // typed and never searched (critique run 13), and empty with no answer.
      setQuery(next === 'overpass' ? (areaQuestion ?? '') : '');
      if (next === 'nominatim') onClear({ source: 'modeChange' });
    },
    [searchMode, areaQuestion, onClear, onModeChange]
  );

  // A radio group is one tab stop; the arrow keys move between the modes.
  const handleModeKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const current = MODES.findIndex((mode) => mode.id === searchMode);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = (current + step + MODES.length) % MODES.length;
    selectMode(MODES[next].id);
    modeRefs.current[next]?.focus();
  };

  const handleClear = useCallback(
    (detail: { source: string }) => {
      setQuery('');
      onClear(detail);
    },
    [onClear]
  );

  return (
    <div className="w-full max-w-lg">
      <div className="overflow-hidden rounded-lg border border-border-default bg-surface-default shadow-lg transition has-[input:focus]:ring-2 has-[input:focus]:ring-base-default">
        <div
          role="radiogroup"
          aria-label="Søkemodus"
          onKeyDown={handleModeKeys}
          className="flex border-b border-border-subtle px-2"
        >
          {MODES.map(({ id, label, Icon }, index) => {
            const checked = searchMode === id;
            return (
              <button
                key={id}
                ref={(node) => {
                  modeRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => {
                  selectMode(id);
                  fieldRef.current?.focus({ preventScroll: true });
                }}
                className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default ${
                  checked
                    ? 'border-base-default text-text-default'
                    : 'border-transparent text-text-subtle hover:text-text-default'
                }`}
              >
                <Icon />
                {label}
              </button>
            );
          })}
        </div>
        <SearchField
          inputRef={fieldRef}
          value={query}
          onChange={setQuery}
          placeholder={
            searchMode === 'nominatim'
              ? 'Søk etter sted eller adresse…'
              : 'F.eks. apotek eller lekeplasser'
          }
          mode={searchMode}
          mapRef={mapRef}
          onSelect={(feature: GeoJSONFeature) => {
            setQuery(feature.properties?.display_name ?? '');
            onSelect(feature);
          }}
          onHover={onHover}
          onUnhover={onUnhover}
          onClear={handleClear}
          onOverpassResults={onOverpassResults}
          savedPlaces={savedPlaces}
          recentPlaces={recentPlaces}
          onClearRecent={onClearRecent}
          showMapHint={showMapHint}
          answerShown={Boolean(areaQuestion)}
        />
      </div>
    </div>
  );
};

export default SearchBar;
