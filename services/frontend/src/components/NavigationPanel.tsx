import React, { useState, useEffect, useRef } from 'react';
import type { GeoJSONFeature } from '../lib/nominatim';
import { Geocode } from '../lib/nominatim';
import { getPlaceTitle, shortStopNames } from '../lib/featureDetails';
import { useRestingLabel } from '../hooks/useRestingLabel';
import { PROFILE_LABELS, type RoutingProfile } from '../lib/routingStatus';
import { translatePlaceType } from '../lib/placeTypes';
import type { MapLngLat } from './Map';
import type { WaypointLocation } from '../lib/locations';
import { CarIcon, FootIcon, BikeIcon } from './ProfileIcons';

const PROFILES: {
  id: RoutingProfile;
  label: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'car', label: PROFILE_LABELS.car, Icon: CarIcon },
  { id: 'foot', label: PROFILE_LABELS.foot, Icon: FootIcon },
  { id: 'bike', label: PROFILE_LABELS.bike, Icon: BikeIcon }
];

/** Circular actions: 32px beside a field (swap), 28px inside one (remove). */
const rowActionClass =
  'flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default';
const inFieldActionClass =
  'absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-subtle transition focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default';

interface LocationInputProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSelect: (feature: GeoJSONFeature) => void;
  onClear: () => void;
  icon: React.ReactNode;
  /**
   * An action that replaces the clear "×" inside the field (a via row's
   * remove), so every row keeps the same width as the stops.
   */
  action?: { label: string; title: string; onClick: () => void; icon: React.ReactNode };
  /** A positive value asks the field to take focus (bumped to refocus). */
  focusToken?: number;
  /**
   * The picked stop's short name ("Kaffebrenneriet Storgata"), shown while the
   * field is at rest; focus brings back the full address to edit.
   */
  restingLabel?: string;
  /**
   * The text of the stop the route actually follows, when one is picked. Text
   * the user has typed but not picked is a draft, and goes back to this on
   * Escape and on leaving the field.
   */
  committed?: string;
  /** A quiet line under the field: what this row's state means for the route. */
  note?: string;
}

/** Which stop field to put focus in; a new `token` repeats the request. */
export interface StopFocusRequest {
  field: 'from' | 'to' | 'via';
  token: number;
}

const LocationInput: React.FC<LocationInputProps> = ({
  label,
  value,
  placeholder,
  onChange,
  onSelect,
  onClear,
  icon,
  action,
  focusToken,
  restingLabel,
  committed,
  note
}) => {
  const [results, setResults] = useState<GeoJSONFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  // Only search while the user is typing in this field. The parent also syncs
  // `value` from outside (e.g. a picked start point); that must not trigger a
  // search or pop the suggestion list over the neighbouring inputs.
  const [focused, setFocused] = useState(false);
  // Keyboard highlight within the suggestion list (-1 = none).
  const [activeIndex, setActiveIndex] = useState(-1);
  // What the last finished lookup found: nothing, or a failure. Shown under the
  // field so a route field never goes silent.
  const [status, setStatus] = useState<'idle' | 'empty' | 'error'>('idle');
  const [retryToken, setRetryToken] = useState(0);
  const statusRef = useRef<HTMLDivElement>(null);
  const suppressSearch = useRef(false);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const inputId = React.useId();
  const listboxId = React.useId();
  const resting = useRestingLabel(value, restingLabel, inputRef);

  useEffect(() => {
    if (focusToken) inputRef.current?.focus({ preventScroll: true });
  }, [focusToken]);

  const trimmedValue = value.trim();

  useEffect(() => {
    if (suppressSearch.current) {
      suppressSearch.current = false;
      return;
    }

    if (!trimmedValue || !focused) {
      setResults([]);
      setShowDropdown(false);
      setActiveIndex(-1);
      setStatus('idle');
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setStatus('idle');

    const timeoutId = window.setTimeout(async () => {
      try {
        const features = await Geocode(trimmedValue);
        if (requestIdRef.current === requestId) {
          setResults(features);
          setShowDropdown(features.length > 0);
          setActiveIndex(-1);
          setStatus(features.length > 0 ? 'idle' : 'empty');
        }
      } catch {
        if (requestIdRef.current === requestId) {
          setResults([]);
          setShowDropdown(false);
          setStatus('error');
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [trimmedValue, focused, retryToken]);

  const handleSelect = (feature: GeoJSONFeature) => {
    suppressSearch.current = true;
    setResults([]);
    setShowDropdown(false);
    setActiveIndex(-1);
    onSelect(feature);
    const displayName = feature?.properties?.display_name;
    if (displayName && typeof displayName === 'string') {
      onChange(displayName);
    }
  };

  const handleClear = () => {
    suppressSearch.current = true;
    setResults([]);
    setShowDropdown(false);
    onChange('');
    onClear();
  };

  // Text typed over a picked stop is a draft: the route keeps following the
  // stop until a new one is picked, so a draft left behind puts the panel and
  // the map at odds. Focusing a picked stop selects it so that typing
  // replaces it, which left one keystroke between "Oslo Sentralstasjon" and a
  // field reading "x" over a route still going there, with Escape and Tab
  // both powerless (critique run 15). The draft goes back on either.
  const drafting = Boolean(committed) && value !== committed;
  const revertDraft = (): boolean => {
    if (!drafting) return false;
    suppressSearch.current = true;
    setResults([]);
    setShowDropdown(false);
    setActiveIndex(-1);
    setStatus('idle');
    onChange(committed as string);
    return true;
  };

  const visibleResults = results.slice(0, 5);
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const open = showDropdown && visibleResults.length > 0;
    if (e.key === 'ArrowDown') {
      if (!open) {
        if (results.length > 0) setShowDropdown(true);
        return;
      }
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % visibleResults.length);
    } else if (e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? visibleResults.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (!open || activeIndex < 0) return;
      e.preventDefault();
      handleSelect(visibleResults[activeIndex]);
    } else if (e.key === 'Escape') {
      // One Escape closes the suggestions, the next puts the picked stop back.
      // An Escape with neither belongs to the panel behind this field.
      if (open) {
        e.preventDefault();
        setShowDropdown(false);
        setActiveIndex(-1);
        return;
      }
      if (revertDraft()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">{label}</label>
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-text-subtle" aria-hidden="true">
          {icon}
        </div>
        <div className="relative flex-1">
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            {...resting.inputProps}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              resting.onFocus();
              setFocused(true);
              if (results.length > 0) setShowDropdown(true);
            }}
            onBlur={(e) => {
              resting.onBlur();
              // Focus moving into the suggestion list (Tab, or a click on an
              // option) must not close it; anything else does.
              const next = e.relatedTarget as Node | null;
              if (next && (listboxRef.current?.contains(next) || statusRef.current?.contains(next))) return;
              setFocused(false);
              setShowDropdown(false);
              setActiveIndex(-1);
              revertDraft();
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={showDropdown && results.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={
              showDropdown && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            aria-autocomplete="list"
            className="w-full text-ellipsis rounded-lg border border-[color:var(--field-border)] bg-surface-default py-2 pl-3 pr-9 text-sm text-text-default placeholder-text-subtle focus:border-base-default focus:outline-none focus:ring-1 focus:ring-base-default"
          />
          {resting.resting && (
            <span id={resting.descriptionId} className="sr-only">
              {value}
            </span>
          )}
          {loading && (
            <div className="absolute right-8 top-1/2 -translate-y-1/2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-border-default border-t-base-default" />
            </div>
          )}
          {action ? (
            <button
              type="button"
              onClick={action.onClick}
              title={action.title}
              aria-label={action.label}
              className={`${inFieldActionClass} hover:bg-danger-surface-default hover:text-danger-text-default`}
            >
              {action.icon}
            </button>
          ) : (
            value && (
              <button
                type="button"
                onClick={handleClear}
                aria-label={`Tøm ${label.toLowerCase()}`}
                className={`${inFieldActionClass} hover:bg-surface-hover hover:text-text-default`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )
          )}
        </div>
      </div>

      {note && <p className="mt-1 pl-10 text-xs text-text-subtle">{note}</p>}

      {/* What the lookup found when it found nothing, or why it failed. */}
      {focused && !loading && trimmedValue && status !== 'idle' && (
        <div
          ref={statusRef}
          className="absolute left-10 right-0 z-panel mt-1 rounded-lg border border-border-default bg-surface-default px-3 py-2 text-sm shadow-lg"
        >
          {status === 'empty' ? (
            <p role="status" className="text-text-subtle">
              Ingen steder funnet for «{trimmedValue}».
            </p>
          ) : (
            <div role="alert" className="flex items-start justify-between gap-3 text-danger-text-default">
              <span>Søket kunne ikke utføres.</span>
              <button
                type="button"
                onClick={() => {
                  inputRef.current?.focus({ preventScroll: true });
                  setRetryToken((n) => n + 1);
                }}
                className="shrink-0 rounded text-xs font-medium text-danger-text-default underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
              >
                Prøv igjen
              </button>
            </div>
          )}
        </div>
      )}

      {/* Dropdown results */}
      {showDropdown && results.length > 0 && (
        <div
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-label={`${label} – forslag`}
          className="absolute left-10 right-0 z-panel mt-1 max-h-48 overflow-y-auto rounded-lg border border-border-default bg-surface-default shadow-lg"
        >
          {visibleResults.map((feature, index) => {
            const { title, locality } = getPlaceTitle(feature);
            const type = translatePlaceType(feature.properties?.type);
            const meta = [type, locality].filter(Boolean).join(' · ');
            return (
              <button
                key={`${feature.properties?.osm_id || index}`}
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                // The full address stays the accessible name: the two lines are its short form.
                aria-label={[feature.properties?.display_name, type].filter(Boolean).join(', ')}
                tabIndex={-1}
                className={`w-full border-b border-border-subtle px-3 py-2 text-left text-sm hover:bg-surface-hover last:border-0 ${
                  index === activeIndex ? 'bg-surface-hover ring-2 ring-inset ring-base-default' : ''
                }`}
                onClick={() => handleSelect(feature)}
              >
                <div className="truncate text-sm font-medium text-text-default">{title}</div>
                {meta && <div className="truncate text-xs text-text-subtle">{meta}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface NavigationPanelProps {
  /** Bumped when route planning is opened from the rail; focuses "Startpunkt". */
  /**
   * Put focus in a stop field: the start (opening route planning, or a route
   * brought back by Angre), the destination, or the newest via row. Bumping
   * `token` repeats a request for the same field.
   */
  focusStop?: StopFocusRequest;
  fromLocation: { coords: MapLngLat; name: string } | null;
  toLocation: { coords: MapLngLat; name: string } | null;
  /** Via-point rows; `coords` is null for a row that has no place picked yet. */
  waypoints: WaypointLocation[];
  routingProfile: RoutingProfile;
  onFromChange: (location: { coords: MapLngLat; name: string } | null) => void;
  onToChange: (location: { coords: MapLngLat; name: string } | null) => void;
  onWaypointsChange: (waypoints: WaypointLocation[]) => void;
  onProfileChange: (profile: RoutingProfile) => void;
  onSwapLocations: () => void;
  onClose: () => void;
}

/**
 * The route panel's question half: where (start, via points, destination) and
 * then how (Kjør / Gå / Sykle, defaulting to Kjør). Everything that depends on
 * a computed route — status, alternatives, the summary and the steps — is
 * rendered by the SideBar beneath it, once a route exists.
 */
const NavigationPanel: React.FC<NavigationPanelProps> = ({
  fromLocation,
  toLocation,
  waypoints,
  routingProfile,
  onFromChange,
  onToChange,
  onWaypointsChange,
  onProfileChange,
  onSwapLocations,
  onClose,
  focusStop
}) => {
  const [fromText, setFromText] = useState(fromLocation?.name || '');
  const [toText, setToText] = useState(toLocation?.name || '');
  const [waypointTexts, setWaypointTexts] = useState<string[]>(waypoints.map(w => w.name));
  // Stable per-row ids so removing a middle waypoint doesn't rebind a
  // LocationInput's internal state to the wrong row (React keys must be stable).
  const waypointIdCounter = useRef(0);
  const [waypointIds, setWaypointIds] = useState<number[]>(() =>
    waypoints.map(() => waypointIdCounter.current++)
  );

  // Sync text with external location changes
  useEffect(() => {
    setFromText(fromLocation?.name || '');
  }, [fromLocation?.name]);

  useEffect(() => {
    setToText(toLocation?.name || '');
  }, [toLocation?.name]);

  useEffect(() => {
    setWaypointTexts(waypoints.map(w => w.name));
    // Keep one stable id per waypoint row; reuse existing ids by position and
    // mint new ones only when the array grows.
    setWaypointIds(prev => {
      if (prev.length === waypoints.length) return prev;
      const next = prev.slice(0, waypoints.length);
      while (next.length < waypoints.length) {
        next.push(waypointIdCounter.current++);
      }
      return next;
    });
  }, [waypoints]);

  const getFeatureCenter = (feature: GeoJSONFeature): MapLngLat | null => {
    const geometry = feature.geometry;
    if (!geometry) return null;

    if (geometry.type === 'Point') {
      const [lng, lat] = geometry.coordinates as [number, number];
      return { lng, lat };
    }

    // For other geometries, compute centroid from bbox or coordinates
    const bbox = feature.bbox;
    if (bbox && bbox.length >= 4) {
      return {
        lng: (bbox[0] + bbox[2]) / 2,
        lat: (bbox[1] + bbox[3]) / 2
      };
    }

    return null;
  };

  const handleFromSelect = (feature: GeoJSONFeature) => {
    const coords = getFeatureCenter(feature);
    if (coords) {
      onFromChange({
        coords,
        name: feature.properties?.display_name || ''
      });
    }
  };

  const handleToSelect = (feature: GeoJSONFeature) => {
    const coords = getFeatureCenter(feature);
    if (coords) {
      onToChange({
        coords,
        name: feature.properties?.display_name || ''
      });
    }
  };

  const handleWaypointSelect = (index: number) => (feature: GeoJSONFeature) => {
    const coords = getFeatureCenter(feature);
    if (coords) {
      const newWaypoints = [...waypoints];
      newWaypoints[index] = {
        coords,
        name: feature.properties?.display_name || ''
      };
      onWaypointsChange(newWaypoints);
    }
  };

  // A new row starts unresolved (coords null). It is only routed through once
  // a place has been picked — never through 0,0.
  const handleAddWaypoint = () => {
    const newWaypoints: WaypointLocation[] = [...waypoints, { coords: null, name: '' }];
    onWaypointsChange(newWaypoints);
    setWaypointTexts(prev => [...prev, '']);
  };

  const handleRemoveWaypoint = (index: number) => {
    const newWaypoints = waypoints.filter((_, i) => i !== index);
    onWaypointsChange(newWaypoints);
    setWaypointTexts(prev => prev.filter((_, i) => i !== index));
  };

  const handleWaypointTextChange = (index: number, value: string) => {
    setWaypointTexts(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // At rest each stop reads by its short name; stops that would read the same
  // add as much of their locality as tells them apart. A field whose text the
  // user has changed shows that text instead.
  const [fromLabel, ...otherLabels] = shortStopNames([
    fromLocation?.name,
    ...waypoints.map((w) => (w.coords ? w.name : undefined)),
    toLocation?.name
  ]);
  const toLabel = otherLabels[waypoints.length];
  // One empty via row at a time: a second one would say nothing new and push
  // the answer further down the panel (critique run 7).
  const hasEmptyWaypoint = waypoints.some(
    (row, index) => !row.coords && !(waypointTexts[index] ?? '').trim()
  );

  return (
    <div>
      {/* Header */}
      <div data-panel-header="" className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-default">Veibeskrivelse</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Lukk veibeskrivelse"
          className="rounded-full p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Where: the stops, top to bottom in travel order */}
      <div className="mt-4 space-y-2">
        <LocationInput
          label="Startpunkt"
          value={fromText}
          restingLabel={fromText === fromLocation?.name ? fromLabel : undefined}
          committed={fromLocation?.name}
          focusToken={focusStop?.field === 'from' ? focusStop.token : undefined}
          placeholder="Velg startpunkt…"
          onChange={setFromText}
          onSelect={handleFromSelect}
          onClear={() => onFromChange(null)}
          icon={
            <div className="h-3 w-3 rounded-full border-2 border-base-default bg-surface-default" />
          }
        />

        {waypointTexts.map((text, index) => (
          <LocationInput
            key={waypointIds[index] ?? index}
            label={`Viapunkt ${index + 1}`}
            value={text}
            restingLabel={text === waypoints[index]?.name ? otherLabels[index] : undefined}
            committed={waypoints[index]?.coords ? waypoints[index]?.name : undefined}
            note={!waypoints[index]?.coords && !text.trim() ? 'Tomt – hoppes over' : undefined}
            placeholder={`Viapunkt ${index + 1}…`}
            focusToken={
              focusStop?.field === 'via' && index === waypointTexts.length - 1 ? focusStop.token : undefined
            }
            onChange={(value) => handleWaypointTextChange(index, value)}
            onSelect={handleWaypointSelect(index)}
            onClear={() => {
              const newWaypoints: WaypointLocation[] = [...waypoints];
              newWaypoints[index] = { coords: null, name: '' };
              onWaypointsChange(newWaypoints);
            }}
            icon={
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-info-surface-tinted text-xs font-medium text-info-text-default">
                {index + 1}
              </div>
            }
            action={{
              label: `Fjern viapunkt ${index + 1}`,
              title: 'Fjern viapunkt',
              onClick: () => handleRemoveWaypoint(index),
              icon: (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )
            }}
          />
        ))}

        <LocationInput
          label="Destinasjon"
          value={toText}
          restingLabel={toText === toLocation?.name ? toLabel : undefined}
          committed={toLocation?.name}
          focusToken={focusStop?.field === 'to' ? focusStop.token : undefined}
          placeholder="Velg destinasjon…"
          onChange={setToText}
          onSelect={handleToSelect}
          onClear={() => onToChange(null)}
          icon={
            <div className="h-3 w-3 rounded-full bg-danger-base-default" />
          }
        />

        {/* Stop actions on one row beneath the stops, aligned with the
            fields' text edge (icon slot + gap = 40px); the swap circle sits
            in the same column as a via row's remove circle. */}
        <div className="flex items-center justify-between pl-10">
          <button
            type="button"
            onClick={handleAddWaypoint}
            disabled={hasEmptyWaypoint}
            title={hasEmptyWaypoint ? 'Fyll inn det tomme viapunktet først' : undefined}
            className="-ml-1 flex h-8 items-center gap-1.5 rounded-md px-1 text-sm text-text-subtle transition hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-text-subtle"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Legg til viapunkt
          </button>
          <button
            type="button"
            onClick={onSwapLocations}
            className={`${rowActionClass} hover:bg-surface-hover hover:text-text-default`}
            title="Bytt start og destinasjon"
            aria-label="Bytt start og destinasjon"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* How: beneath where. One segmented control, Kjør preselected, so the
          panel opens with a single decision left to make. */}
      <div className="mt-4 border-t border-border-subtle pt-4">
        <div
          role="group"
          aria-label="Reisemiddel"
          className="flex overflow-hidden rounded-lg border border-[color:var(--field-border)]"
        >
          {PROFILES.map(({ id, label, Icon }, index) => {
            const active = routingProfile === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onProfileChange(id)}
                aria-pressed={active}
                className={`flex flex-1 items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                  index > 0 ? 'border-l border-[color:var(--field-border)]' : ''
                } ${
                  active
                    ? 'bg-main-base-default text-main-base-contrast-default focus-visible:ring-border-strong'
                    : 'text-text-subtle hover:bg-surface-hover hover:text-text-default focus-visible:ring-base-default'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default NavigationPanel;
