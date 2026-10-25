import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoJSONFeature } from '../lib/nominatim';
import {
  MAX_RECENT_PLACES,
  MAX_SAVED_PLACES,
  RECENT_PLACES_KEY,
  SAVED_PLACES_KEY,
  addSaved,
  isSaved,
  loadPlaces,
  pushRecent,
  removeSaved,
  savePlaces,
  toStoredPlace,
  type StoredPlace
} from '../lib/places';

export type ToggleSavedResult = 'added' | 'removed' | 'full' | 'unsupported';

/** Where a saved place stood, so an "Angre" can put it back there. */
export interface SavedPosition {
  /** Its index in the list (newest first). */
  index: number;
  /** The entry just above it, if any. */
  previousId?: string;
  /** The entry just below it, if any. */
  nextId?: string;
}

export interface PlacesState {
  /** Recently selected search results, newest first. */
  recent: StoredPlace[];
  /** "Mine steder", newest first. */
  saved: StoredPlace[];
  /** Record a selected search result as a recent search. */
  addRecent: (feature: GeoJSONFeature) => void;
  /** Empty the recent list; returns what was there so it can be restored. */
  clearRecent: () => StoredPlace[];
  /**
   * Put a previously cleared recent list back ("Angre"), below any search made
   * since, which is newer.
   */
  restoreRecent: (places: StoredPlace[]) => void;
  /** Add the feature to Mine steder, or remove it when it is already there. */
  toggleSaved: (feature: GeoJSONFeature) => ToggleSavedResult;
  /**
   * Put a place removed from Mine steder back where it stood ("Angre"): beside
   * the neighbours it had, else at its old index. False only when the list
   * filled up in the meantime; true, and nothing changes, when the place is
   * already back.
   */
  restoreSaved: (place: StoredPlace, position: SavedPosition) => boolean;
  isFeatureSaved: (feature: GeoJSONFeature | null) => boolean;
}

const browserStorage = (): Storage | undefined =>
  typeof localStorage !== 'undefined' ? localStorage : undefined;

/**
 * Recent searches and saved places, persisted in localStorage.
 *
 * Writes happen only after a user action (the `dirty` flags), never on mount:
 * a read-only or full store must not produce a write before the user has done
 * anything, and a failed write simply means "this session only".
 */
export function usePlaces(): PlacesState {
  const [recent, setRecent] = useState<StoredPlace[]>(() =>
    loadPlaces(browserStorage(), RECENT_PLACES_KEY)
  );
  const [saved, setSaved] = useState<StoredPlace[]>(() =>
    loadPlaces(browserStorage(), SAVED_PLACES_KEY)
  );
  const recentDirty = useRef(false);
  const savedDirty = useRef(false);
  // An "Angre" runs seconds after the render that created it; it must see the
  // list as it is then, not as that render's closure saw it.
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  useEffect(() => {
    if (!recentDirty.current) return;
    recentDirty.current = false;
    if (!savePlaces(browserStorage(), RECENT_PLACES_KEY, recent)) {
      console.warn('[places] Could not persist recent searches; keeping them for this session only');
    }
  }, [recent]);

  useEffect(() => {
    if (!savedDirty.current) return;
    savedDirty.current = false;
    if (!savePlaces(browserStorage(), SAVED_PLACES_KEY, saved)) {
      console.warn('[places] Could not persist Mine steder; keeping them for this session only');
    }
  }, [saved]);

  const addRecent = useCallback((feature: GeoJSONFeature) => {
    const place = toStoredPlace(feature);
    if (!place) return;
    recentDirty.current = true;
    setRecent((prev) => pushRecent(prev, place));
  }, []);

  const clearRecent = useCallback((): StoredPlace[] => {
    const previous = recent;
    recentDirty.current = true;
    setRecent([]);
    return previous;
  }, [recent]);

  const restoreRecent = useCallback((places: StoredPlace[]) => {
    recentDirty.current = true;
    // A search made since the clear is newer, so it stays on top; replacing
    // the list outright threw it away.
    setRecent((current) =>
      [...current, ...places.filter((place) => !current.some((entry) => entry.id === place.id))].slice(
        0,
        MAX_RECENT_PLACES
      )
    );
  }, []);

  const toggleSaved = useCallback(
    (feature: GeoJSONFeature): ToggleSavedResult => {
      const place = toStoredPlace(feature);
      if (!place) return 'unsupported';
      if (isSaved(saved, place.id)) {
        savedDirty.current = true;
        setSaved(removeSaved(saved, place.id));
        return 'removed';
      }
      const next = addSaved(saved, place);
      if (!next) return 'full';
      savedDirty.current = true;
      setSaved(next);
      return 'added';
    },
    [saved]
  );

  const isFeatureSaved = useCallback(
    (feature: GeoJSONFeature | null): boolean => {
      if (!feature) return false;
      const place = toStoredPlace(feature);
      return place ? isSaved(saved, place.id) : false;
    },
    [saved]
  );

  const restoreSaved = useCallback((place: StoredPlace, position: SavedPosition): boolean => {
    const current = savedRef.current;
    if (isSaved(current, place.id)) return true;
    if (current.length >= MAX_SAVED_PLACES) return false;
    // Beside the neighbours it had, not at a raw index: once the list has
    // changed, an index points into the wrong gap (critique run 13).
    const above = position.previousId ? current.findIndex((entry) => entry.id === position.previousId) : -1;
    const below = position.nextId ? current.findIndex((entry) => entry.id === position.nextId) : -1;
    const at = above >= 0 ? above + 1 : below >= 0 ? below : Math.min(position.index, current.length);
    const next = [...current.slice(0, at), place, ...current.slice(at)];
    savedRef.current = next;
    savedDirty.current = true;
    setSaved(next);
    return true;
  }, []);

  return { recent, saved, addRecent, clearRecent, restoreRecent, toggleSaved, restoreSaved, isFeatureSaved };
}
