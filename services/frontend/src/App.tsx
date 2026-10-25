import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  type MapHandle,
  type MapLngLat,
  type RouteVisibility,
  type StreetViewEventDetail
} from './components/Map';
import SearchBar from './components/SearchBar';
import ContextMenu from './components/ContextMenu';
import SideBar, { type LocationWithName } from './components/SideBar';
import StreetViewPanel, { type StreetViewSelection } from './components/StreetViewPanel';
import OverpassResults from './components/OverpassResults';
import { isStreetViewConfigured } from './lib/streetViewLayer';
import HealthDashboard from './components/HealthDashboard';
import type { GeoJSONFeature } from './lib/nominatim';
import type { RouteResponse, RouteResult, AvoidArea } from './lib/graphhopper';
import { getRoute, routeResponseToFeatureCollection, RouteError } from './lib/graphhopper';
import type { OverpassSearchMeta } from './lib/overpass';
import { toPlaceFeature } from './lib/overpassFeature';
import { toUserMessage } from './lib/errors';
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  loadMapConfig,
  type MapConfig
} from './config/map.config';
import { applyTheme } from './lib/mapColors';
import { applyUiTheme } from './lib/theme';
import { defaultMapStyles, type MapStyle } from './lib/mapStyles';
import { ReverseGeocode } from './lib/nominatim';
import {
  reconcileWaypointLocations,
  resolvedWaypointCoords,
  type WaypointLocation
} from './lib/locations';
import { fetchWithTimeout } from './lib/fetchWithTimeout';
import { parseMapHash, serializeMapHash, type MapHashState } from './lib/urlState';
import { useToast } from './components/toast';
import UndoNotice from './components/UndoNotice';
import { usePlaces } from './hooks/usePlaces';
import { MAX_SAVED_PLACES, toStoredPlace } from './lib/places';
import type { StopFocusRequest } from './components/NavigationPanel';
import { getPlaceTitle } from './lib/featureDetails';
import { formatLatLng } from './lib/format';
import { copyText } from './lib/clipboard';
import { statusForResult, type RoutingStatus, routeFailureMessage, type RoutingProfile } from './lib/routingStatus';
import { EMPTY_HIGHLIGHT, highlightGeometry, type RouteHighlight } from './lib/routeDetails';

/** The toast offering to bring closed area-search results back. */
const AREA_RESULTS_TOAST = 'area-results';
/** The toast offering to bring a closed route back. */
const ROUTE_CLOSED_TOAST = 'route-closed';
/** The toast offering to bring cleared avoid areas back. */
const AVOID_AREAS_TOAST = 'avoid-areas';
/** The toast offering to bring cleared recent searches back. */
const RECENT_SEARCHES_TOAST = 'recent-searches';

/**
 * After an Angre, focus goes to what came back, once it has rendered, rather
 * than onto the page: the toast that held focus is gone, and the control the
 * user pressed before it often went with the thing it removed (critique
 * run 12).
 */
function focusAfterUndo(selector: string | null, fallback?: HTMLElement | null): void {
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => {
    const target = (selector ? document.querySelector<HTMLElement>(selector) : null) ?? fallback;
    target?.focus({ preventScroll: true });
  });
}

interface ContextMenuState {
  show: boolean;
  x: number;
  y: number;
  lngLat: MapLngLat;
}


type BoundingBox = [number, number, number, number];

const flattenCoordinates = (input: unknown, handler: (lng: number, lat: number) => void) => {
  if (!Array.isArray(input)) return;
  if (input.length >= 2 && typeof input[0] === 'number' && typeof input[1] === 'number') {
    handler(input[0], input[1]);
    return;
  }
  input.forEach((item) => flattenCoordinates(item, handler));
};

const computeBoundingBox = (features: GeoJSONFeature[]): BoundingBox | null => {
  const bounds: BoundingBox = [Infinity, Infinity, -Infinity, -Infinity];

  features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return;

    if (geometry.type === 'Point') {
      const [lng, lat] = geometry.coordinates as [number, number];
      bounds[0] = Math.min(bounds[0], lng);
      bounds[1] = Math.min(bounds[1], lat);
      bounds[2] = Math.max(bounds[2], lng);
      bounds[3] = Math.max(bounds[3], lat);
      return;
    }

    if ('coordinates' in geometry) {
      flattenCoordinates(geometry.coordinates, (lng, lat) => {
        if (typeof lng === 'number' && typeof lat === 'number') {
          bounds[0] = Math.min(bounds[0], lng);
          bounds[1] = Math.min(bounds[1], lat);
          bounds[2] = Math.max(bounds[2], lng);
          bounds[3] = Math.max(bounds[3], lat);
        }
      });
    }
  });

  if (bounds[0] === Infinity) {
    return null;
  }

  return bounds;
};

/**
 * The frame a route asks for: the line the map draws and every stop the panel
 * names, so neither the numbers nor a stop can point somewhere off screen.
 */
const routeBoundingBox = (route: RouteResult | undefined, stops: MapLngLat[]): BoundingBox | null => {
  const bounds: BoundingBox = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (lng: number, lat: number) => {
    bounds[0] = Math.min(bounds[0], lng);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lng);
    bounds[3] = Math.max(bounds[3], lat);
  };
  if (route) flattenCoordinates(route.geometry.coordinates, add);
  stops.forEach((stop) => add(stop.lng, stop.lat));
  return bounds[0] === Infinity ? null : bounds;
};

/** Frame an area answer's hits on the map, as when it arrived. */
const frameHits = (map: MapHandle | null, features: GeoJSONFeature[]): void => {
  const bbox = computeBoundingBox(features);
  if (bbox) map?.jumpToBoundingBox(bbox);
};

const buildStreetViewUrl = (id: string, template?: string | null): string | null => {
  if (!template) return null;
  const encoded = encodeURIComponent(id);
  if (template.includes('{id}')) {
    return template.replace('{id}', encoded);
  }
  if (template.endsWith('/')) {
    return `${template}${encoded}`;
  }
  return `${template}/${encoded}`;
};

const App: React.FC = () => {
  const mapRef = useRef<MapHandle | null>(null);
  const toast = useToast();
  // Focus hand-offs: the search input gets focus back when the details card
  // closes, the rail's route button when the route panel closes.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const directionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusDirectionsOnCloseRef = useRef(false);

  const {
    recent: recentPlaces,
    saved: savedPlaces,
    addRecent,
    clearRecent,
    restoreRecent,
    toggleSaved,
    restoreSaved,
    isFeatureSaved
  } = usePlaces();

  const [configLoaded, setConfigLoaded] = useState(false);
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
  const [mapStyles, setMapStyles] = useState<MapStyle[]>(defaultMapStyles);
  const [mapZoom, setMapZoom] = useState<number>(DEFAULT_MAP_ZOOM);
  const [mapCenter, setMapCenter] = useState<MapLngLat>({ ...DEFAULT_MAP_CENTER });
  // Active base-style id, synced to/from the URL hash. null = use map default.
  const [activeStyleId, setActiveStyleId] = useState<string | null>(null);
  // Live map view (zoom + center) reported by Leaflet move/zoom events. Kept
  // in a ref: it only feeds the debounced permalink writer, and holding it in
  // state re-rendered the whole app tree on every pan and zoom.
  const mapViewRef = useRef<{ zoom: number; lat: number; lng: number } | null>(null);
  const hashTimerRef = useRef<number | null>(null);
  const writeHashRef = useRef<() => void>(() => {});
  // Guards the hash-writer effect against the programmatic write we make while
  // restoring state from the URL on load (avoids an immediate echo).
  const hashWriteGuardRef = useRef(false);
  // Holds the route waypoints recovered from the hash until config has loaded
  // and we can re-trigger routing through the normal flow.
  const pendingRouteRef = useRef<MapLngLat[] | null>(null);

  const [selectedFeature, setSelectedFeature] = useState<GeoJSONFeature | null>(null);
  const [hoveredFeature, setHoveredFeature] = useState<GeoJSONFeature | null>(null);
  // Full routing result (primary + alternatives) and which one is active.
  const [routeResponse, setRouteResponse] = useState<RouteResponse | null>(null);
  // What the route details point at: a position along the route (the
  // profile) and a detail category (preview and pinned). Drawn by Map.
  const [routeHighlight, setRouteHighlight] = useState<RouteHighlight>(EMPTY_HIGHLIGHT);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  // Loading/empty/error state for the routing request, surfaced in the SideBar.
  const [routingStatus, setRoutingStatus] = useState<RoutingStatus>('idle');
  // Backend-supplied (Norwegian) reason for a routing failure, when known.
  const [routingError, setRoutingError] = useState<string | null>(null);
  // Monotonic id so a slow request that resolves after a newer one can't clobber
  // the displayed status/result.
  const routeRequestIdRef = useRef(0);
  // The stops of the route last framed on the map. A route is framed when its
  // stops change, not whenever it is asked for again: adding an empty via row,
  // or picking the place a field already held, re-runs the same route and
  // must not pull the view away from wherever the user has since taken it.
  // Cleared when the route empties, so a route begun again is framed again.
  const framedStopsRef = useRef<string | null>(null);
  // Routing options that switch the backend into flexible mode.
  const [alternativesEnabled, setAlternativesEnabled] = useState(false);
  const [avoidAreas, setAvoidAreas] = useState<AvoidArea[]>([]);
  const [overpassFeatures, setOverpassFeatures] = useState<GeoJSONFeature[]>([]);
  // Whether the compact card's facts are unfolded, reported up by SideBar.
  // Unfolding is a request to read them, so the rail's priority inverts: the
  // list drops to its header and a row, the card takes the room, and folding
  // hands it straight back (critique run 10).
  const [cardFactsOpen, setCardFactsOpen] = useState(false);
  // The question behind the current area-search results, and how it was read.
  const [overpassMeta, setOverpassMeta] = useState<OverpassSearchMeta | null>(null);
  // How many of those hits the map's view has left out, reported by the map on
  // every pan and zoom so the list can say so (critique run 16).
  const [hiddenHitCount, setHiddenHitCount] = useState(0);
  // And how much of the route it shows, for the same reason.
  const [routeVisibility, setRouteVisibility] = useState<RouteVisibility>('whole');
  const [fromMarker, setFromMarker] = useState<MapLngLat | null>(null);
  const [toMarker, setToMarker] = useState<MapLngLat | null>(null);
  const [waypoints, setWaypoints] = useState<MapLngLat[]>([]);
  const [routingProfile, setRoutingProfile] = useState<RoutingProfile>('car');

  // Navigation mode state - tracks locations with names for the sidebar
  const [navigationMode, setNavigationMode] = useState(false);
  const [fromLocation, setFromLocation] = useState<LocationWithName | null>(null);
  const [toLocation, setToLocation] = useState<LocationWithName | null>(null);
  const [waypointLocations, setWaypointLocations] = useState<WaypointLocation[]>([]);

  const [streetViewSelection, setStreetViewSelection] = useState<StreetViewSelection | null>(null);
  const [streetViewMetadata, setStreetViewMetadata] = useState<Record<string, unknown> | null>(null);
  const [streetViewLoading, setStreetViewLoading] = useState(false);
  const [streetViewError, setStreetViewError] = useState<string | null>(null);
  const [streetViewLayerVisible, setStreetViewLayerVisible] = useState(false);
  const [healthDashboardOpen, setHealthDashboardOpen] = useState(false);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    show: false,
    x: 0,
    y: 0,
    lngLat: { lng: 0, lat: 0 }
  });

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const cfg = await loadMapConfig();
        if (!isMounted) return;
        // Apply color theme BEFORE the Map mounts so the imperative Leaflet
        // layers pick up the overridden mapColors on first render, and the UI
        // chrome ramps are in place before any chrome paints (the loading gate
        // below is still showing). applyUiTheme injects --mtds-color-* overrides
        // for the design-system tokens (light + dark); applyTheme handles the
        // JS-set Leaflet geometry colors.
        applyTheme(cfg.theme);
        applyUiTheme(cfg.theme);
        if (cfg.theme?.primary && typeof document !== 'undefined') {
          document.documentElement.style.setProperty('--app-primary', cfg.theme.primary);
        }
        setMapConfig(cfg);
        const effectiveStyles = cfg.styles.length ? cfg.styles : defaultMapStyles;
        if (cfg.styles.length) {
          setMapStyles(cfg.styles);
        }
        if (typeof cfg.defaultZoom === 'number') {
          setMapZoom(cfg.defaultZoom);
        }
        if (
          cfg.defaultCenter &&
          typeof cfg.defaultCenter.lng === 'number' &&
          typeof cfg.defaultCenter.lat === 'number'
        ) {
          setMapCenter(cfg.defaultCenter);
        }

        // Restore shareable state from the URL hash, overriding config defaults.
        const hashState =
          typeof window !== 'undefined' ? parseMapHash(window.location.hash) : null;
        if (hashState?.view) {
          // Don't let the restore write back to the hash and clobber it.
          hashWriteGuardRef.current = true;
          setMapZoom(hashState.view.zoom);
          setMapCenter({ lng: hashState.view.lng, lat: hashState.view.lat });
        }
        if (hashState?.style && effectiveStyles.some((s) => s.id === hashState.style)) {
          setActiveStyleId(hashState.style);
        }
        if (hashState?.route && hashState.route.length >= 2) {
          pendingRouteRef.current = hashState.route.map((p) => ({ lng: p.lng, lat: p.lat }));
        }

        // The panorama layer is a tool the user picks up, not a default: it
        // starts off (decided 2026-09-13) unless a shared link asks for it.
        setStreetViewLayerVisible(
          Boolean(cfg.streetview?.enabled) && hashState?.streetview === true
        );
      } catch (error) {
        console.error('Failed to load map config:', error);
      } finally {
        if (isMounted) {
          setConfigLoaded(true);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const closeStreetViewPanel = useCallback(() => {
    setStreetViewSelection(null);
    setStreetViewMetadata(null);
    setStreetViewError(null);
    setStreetViewLoading(false);
  }, []);

  useEffect(() => {
    if (!streetViewLayerVisible) {
      closeStreetViewPanel();
    }
  }, [streetViewLayerVisible, closeStreetViewPanel]);

  // Derived GeoJSON for the map: routes (selected solid, others dashed/grey) +
  // dashed connector segments. Recomputed when the response or selection change.
  const routeFeature = useMemo(
    () =>
      routeResponse ? routeResponseToFeatureCollection(routeResponse, selectedRouteIndex) : null,
    [routeResponse, selectedRouteIndex]
  );

  const computeRoute = useCallback(
    async (overrides?: {
      from?: MapLngLat | null;
      to?: MapLngLat | null;
      waypoints?: MapLngLat[];
      profile?: RoutingProfile;
      alternatives?: boolean;
      avoidAreas?: AvoidArea[];
      /**
       * Bring the route wholly onto the map once it arrives. An answer with
       * an extent is always wholly on the map, as a map gesture never moves
       * it: a route is the one answer here that is a shape, and it was the
       * only one the map never framed — Oslo to Bergen read "463 km · 6 t"
       * over a line leaving the corner, with no control that would show the
       * rest (critique run 16). A route already in view stays as it is.
       * Set where the stops are chosen — the panel's fields, the place card,
       * the map menu, Angre — and not for a refinement of the route in view
       * (a profile, alternatives, an avoid area, a swap, a retry), nor a stop
       * dragged on the map, where the user's hand is already on the view.
       */
      fit?: boolean;
    }) => {
      const origin = overrides?.from ?? fromMarker;
      const destination = overrides?.to ?? toMarker;
      const via = overrides?.waypoints ?? waypoints;
      const profile = overrides?.profile ?? routingProfile;
      const alternatives = overrides?.alternatives ?? alternativesEnabled;
      const areas = overrides?.avoidAreas ?? avoidAreas;

      if (!origin || !destination) {
        setRouteResponse(null);
        setRoutingStatus('idle');
        framedStopsRef.current = null;
        return;
      }

      const requestId = ++routeRequestIdRef.current;
      setRoutingStatus('loading');
      setRoutingError(null);

      try {
        const response = await getRoute([origin, ...via, destination], {
          profile,
          alternatives,
          avoidAreas: areas
        });
        // Ignore results from a superseded request.
        if (routeRequestIdRef.current !== requestId) return;

        setRouteResponse(response);
        setRouteProfile(profile);
        // Reset the active selection to the primary route on every recompute.
        setSelectedRouteIndex(0);

        // "No route" and failures are reported once, in the route panel's
        // banner next to the fields that caused them; a toast on top used to
        // announce the same sentence twice and stack on every recompute.
        setRoutingStatus(statusForResult(response));

        if (overrides?.fit && response && response.routes.length > 0) {
          const stops = [origin, ...via, destination];
          const key = stops.map((stop) => `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`).join(';');
          if (key !== framedStopsRef.current) {
            framedStopsRef.current = key;
            // The primary route: a new computation always selects it (above).
            // Revealed, not re-fitted: a route planned where the user is
            // already looking leaves the view alone.
            const bbox = routeBoundingBox(response.routes[0], stops);
            if (bbox) mapRef.current?.revealBoundingBox(bbox);
          }
        }
      } catch (error) {
        if (routeRequestIdRef.current !== requestId) return;
        // A failed recalculation keeps the last route on the map and in the
        // panel, marked as the previous one, instead of taking away the only
        // answer the user had; the banner says why and offers "Prøv igjen".
        setRoutingStatus('error');
        console.error('Failed to get route:', error);
        let message: string;
        if (error instanceof RouteError) {
          message = error.message;
        } else if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'TimeoutError') {
          message = 'Kunne ikke beregne ruten. Rutetjenesten brukte for lang tid på å svare.';
        } else {
          message = routeFailureMessage();
        }
        setRoutingError(message);
      }
    },
    [fromMarker, toMarker, waypoints, routingProfile, alternativesEnabled, avoidAreas]
  );

  // A highlight belongs to one route: a new route, another alternative or a
  // closed panel puts it out.
  useEffect(() => {
    setRouteHighlight(EMPTY_HIGHLIGHT);
  }, [routeResponse, selectedRouteIndex, navigationMode]);

  // The route the panel describes: the selected alternative, else the first.
  const selectedRoute = useMemo<RouteResult | null>(
    () =>
      routeResponse
        ? (routeResponse.routes.find((r: RouteResult) => r.routeIndex === selectedRouteIndex) ?? routeResponse.routes[0] ?? null)
        : null,
    [routeResponse, selectedRouteIndex]
  );

  // What the route details point at, as plain geometry for the map.
  const routeHighlightGeometry = useMemo(
    () => (selectedRoute ? highlightGeometry(selectedRoute, routeHighlight) : null),
    [selectedRoute, routeHighlight]
  );

  // Restore a route shared via the URL hash once config has loaded. Runs once.
  const routeRestoredRef = useRef(false);
  useEffect(() => {
    if (!configLoaded || routeRestoredRef.current) return;
    const pending = pendingRouteRef.current;
    pendingRouteRef.current = null;
    routeRestoredRef.current = true;
    if (!pending || pending.length < 2) return;

    const from = pending[0];
    const to = pending[pending.length - 1];
    const via = pending.slice(1, -1);

    setNavigationMode(true);
    setFromMarker(from);
    setToMarker(to);
    setWaypoints(via);
    // Resolve human-readable names in the background for the sidebar.
    void (async () => {
      const [fromName, toName, viaNames] = await Promise.all([
        getLocationName(from),
        getLocationName(to),
        Promise.all(via.map((p: MapLngLat) => getLocationName(p)))
      ]);
      setFromLocation({ coords: from, name: fromName });
      setToLocation({ coords: to, name: toName });
      setWaypointLocations(via.map((coords: MapLngLat, i: number) => ({ coords, name: viaNames[i] })));
    })();
    void computeRoute({ from, to, waypoints: via });
    // getLocationName/computeRoute identities are stable enough here; we only
    // ever want this to fire once after the initial config load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded]);

  // Selecting a place (search result or a plain map click, which reverse-
  // geocodes) must not discard an existing route: every click on the map,
  // the route line or a route marker used to wipe it. Routing state is only
  // cleared explicitly (close navigation / clear search).
  // What the details card says under the name when a map click could not be
  // turned into an address (the feature then holds only the coordinates).
  const [selectedFeatureNote, setSelectedFeatureNote] = useState<string | null>(null);
  // The point a failed "Hva er her?" asked about, so its card can ask again.
  const [featureRetryAt, setFeatureRetryAt] = useState<MapLngLat | null>(null);
  // The travel mode of the route now drawn; after a failed recalculation it is
  // no longer the pressed one, and the panel says which route it is showing.
  const [routeProfile, setRouteProfile] = useState<RoutingProfile | null>(null);
  // Whether the card may take focus when it opens (false when a late answer
  // lands while the user has moved on; the card is then announced instead).
  const [selectedFeatureFocus, setSelectedFeatureFocus] = useState(true);
  // The area-search hit whose card is open, when the card shows one.
  const selectedOverpassIndex: number | null =
    typeof selectedFeature?.properties?.__overpassIndex === 'number'
      ? selectedFeature.properties.__overpassIndex
      : null;

  const handleSelect = useCallback(
    (feature: GeoJSONFeature, note?: string, options?: { jump?: boolean; focus?: boolean }) => {
      setSelectedFeature(feature);
      setSelectedFeatureNote(note ?? null);
      setFeatureRetryAt(null);
      setSelectedFeatureFocus(options?.focus !== false);
      setHoveredFeature(null);
      // The area-search answer is NOT cleared here, nor anywhere else that
      // opens a card: that answer can cost a minute of inference, and asking
      // what one point is must not destroy the list of what was found
      // (critique run 9). Only another area answer replaces it, and only
      // "Lukk resultatliste" removes it, which offers an Angre.
      closeStreetViewPanel();
      setContextMenu((prev: ContextMenuState) => ({ ...prev, show: false }));
      if (options?.jump !== false) mapRef.current?.jumpToFeature(feature);
    },
    [closeStreetViewPanel]
  );

  // Only picks made in the search field count as recent searches. The map's
  // own click handler also selects through handleSelect (reverse geocoding),
  // and an eight-slot list would be flooded by map clicks.
  const handleSearchSelect = useCallback(
    (feature: GeoJSONFeature) => {
      // Looking a place up keeps the area answer, as a map click does: finding
      // the hits and then checking one of them against an address is the whole
      // loop. This was the last path that threw the answer away, and it did it
      // silently — no toast, no Angre, nothing said (critique run 15).
      handleSelect(feature);
      addRecent(feature);
    },
    [handleSelect, addRecent]
  );

  // A place asked about on the map: a click, Enter on the focused map, or
  // "Hva er her?" in the map menu. The view never moves: the user put the map
  // where it is, and a jump to street level would lose that overview (decided
  // 2026-09-14). While a route is being planned the card opens above the route
  // panel and the route is not touched.
  const handleMapSelect = useCallback(
    (feature: GeoJSONFeature, note?: string, options?: { focus?: boolean; retry?: boolean }) => {
      handleSelect(feature, note, { jump: false, focus: options?.focus });
      // A failed lookup keeps its point, so the card can ask the same question
      // again instead of sending the user back to the same pixel.
      const geometry = options?.retry ? feature.geometry : null;
      if (geometry && geometry.type === 'Point') {
        const [lng, lat] = geometry.coordinates as [number, number];
        setFeatureRetryAt({ lng, lat });
      }
    },
    [handleSelect]
  );

  // An area-search hit answers like a searched place: the same card, docked
  // above the results list, which stays so hits can be compared. The hit's
  // dot is drawn selected, and the map pans only if the hit is hidden.
  const handleOverpassSelect = useCallback(
    (index: number) => {
      const hit = overpassFeatures[index];
      if (!hit) return;
      setSelectedFeature(toPlaceFeature(hit, index));
      setSelectedFeatureNote(null);
      setSelectedFeatureFocus(true);
      setHoveredFeature(null);
      closeStreetViewPanel();
      setContextMenu((prev: ContextMenuState) => ({ ...prev, show: false }));
      mapRef.current?.revealOverpassFeature(index);
    },
    [overpassFeatures, closeStreetViewPanel]
  );

  // Closing a hit's card hands focus back to its row; any other card hands it
  // back to the search field.
  const focusAfterCard = useCallback((hitIndex: number | null) => {
    const row =
      hitIndex === null ? null : document.querySelector<HTMLElement>(`[data-overpass-row="${hitIndex}"]`);
    if (row) row.focus({ preventScroll: true });
    else searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleToggleSaved = useCallback(() => {
    if (!selectedFeature) return;
    // Mine steder exists only in this browser, so a mis-pressed star must be
    // undoable like every other one-click removal (critique run 11): note the
    // stored entry and where it stood before it goes.
    const stored = toStoredPlace(selectedFeature);
    const index = stored ? savedPlaces.findIndex((place) => place.id === stored.id) : -1;
    const removed = index >= 0 ? savedPlaces[index] : null;
    const position = { index, previousId: savedPlaces[index - 1]?.id, nextId: savedPlaces[index + 1]?.id };
    // Named the way people say it, never by the stored database string.
    const placeName = getPlaceTitle(selectedFeature).title;
    const outcome = toggleSaved(selectedFeature);
    // One toast per place: a second press on the same star replaces the first
    // instead of stacking "Lagret" over "Fjernet", while removing two places
    // in a row keeps an Angre for each; one shared id threw the first away
    // (critique run 12).
    const id = stored ? `saved-place-${stored.id}` : 'saved-place';
    if (outcome === 'added') {
      toast.success('Lagret i Mine steder', { id });
    } else if (outcome === 'removed') {
      // The Angre can be pressed after another card has opened, so the toast
      // names the place it would bring back.
      toast.info(removed ? `«${placeName}» er fjernet fra Mine steder` : 'Fjernet fra Mine steder', {
        id,
        // Every removal from Mine steder is one subject: a second replaces
        // the first's undo, while an area answer's undo waits beside it.
        subject: 'saved-place',
        // Shown at the foot of the search card, where Mine steder is listed.
        inline: true,
        ...(removed && {
          action: {
            label: 'Angre',
            onClick: () => {
              if (restoreSaved(removed, position)) {
                // The star on the card, or, with the card closed, the field
                // "Mine steder" belongs to (emptied, it lists the place again).
                focusAfterUndo('[data-saved-toggle]', searchInputRef.current);
              } else {
                // Its own id: this toast's own dismissal would take it along.
                toast.warning(`«${placeName}» ble ikke lagt tilbake. Mine steder er fullt (maks ${MAX_SAVED_PLACES}).`, {
                  id: `${id}-full`
                });
              }
            }
          }
        })
      });
    } else if (outcome === 'full') {
      toast.warning(`Mine steder er fullt (maks ${MAX_SAVED_PLACES})`, { id });
    } else if (outcome === 'unsupported') {
      toast.warning('Dette stedet kan ikke lagres: det mangler navn eller posisjon.', { id });
    }
  }, [selectedFeature, savedPlaces, toggleSaved, restoreSaved, toast]);

  // Clearing the recent list is one click; it can be taken back where the
  // list was, at the foot of the field it belongs to (see UndoNotice).
  const handleClearRecent = useCallback(() => {
    const previous = clearRecent();
    if (previous.length === 0) return;
    // "Tøm nylige søk" goes with the list it cleared; focus stays in the field
    // the list belongs to, for the clear and for its Angre, instead of falling
    // on the page (critique run 13).
    searchInputRef.current?.focus({ preventScroll: true });
    toast.info('Nylige søk er tømt', {
      id: RECENT_SEARCHES_TOAST,
      // Shown under the search field, where the list was.
      inline: true,
      action: {
        label: 'Angre',
        onClick: () => {
          restoreRecent(previous);
          focusAfterUndo(null, searchInputRef.current);
        }
      }
    });
  }, [clearRecent, restoreRecent, toast]);

  // Hovering a result only highlights it on the map; jumping happens on
  // click. Moving the view on every mouse-over fired moveend, a permalink
  // write and a street-view fetch per hovered row.
  const handleHover = useCallback((feature: GeoJSONFeature) => {
    setHoveredFeature(feature);
  }, []);

  const handleUnhover = useCallback(() => {
    setHoveredFeature(null);
  }, []);

  // Closes the place card. It never touches a route: a route changes only
  // through the route panel (its fields, its stop actions, and its close,
  // which offers "Angre"). Clearing the search used to delete the route here.
  const clearSelection = useCallback(() => {
    setSelectedFeature(null);
    setSelectedFeatureNote(null);
    closeStreetViewPanel();
  }, [closeStreetViewPanel]);

  // Clearing the field or switching the search mode asks nothing new, so an
  // area answer on screen stays: only a pick in the field replaces it, and
  // closing the list (×, with Angre) removes it. Both used to throw away an
  // answer that can cost a minute of inference, with no way back; one arrow
  // key in the mode radios was enough (critique run 12).
  const handleClear = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const handleOverpassResults = useCallback((features: GeoJSONFeature[], meta: OverpassSearchMeta) => {
    // A newer answer retires the Angre for an older one: pressed now, it put
    // the old hits back over the new ones while the field asked the new
    // question (critique run 12).
    toast.dismiss(AREA_RESULTS_TOAST);
    setOverpassFeatures(features);
    setOverpassMeta(meta);
    // A new answer replaces the old hits, so a card showing one of them closes.
    setSelectedFeature((prev: GeoJSONFeature | null) =>
      typeof prev?.properties?.__overpassIndex === 'number' ? null : prev
    );
    frameHits(mapRef.current, features);
  }, [toast]);

  // "Vis alle treff": the list's answer back on the map, framed as it was when
  // it arrived.
  const handleShowAllHits = useCallback(() => frameHits(mapRef.current, overpassFeatures), [overpassFeatures]);

  // "Vis ruten": the route back on the map. Two controls carry it — the note
  // under the numbers when the route has left the view, and the bar standing
  // in for numbers scrolled out of the panel, which also brings them back.
  // The bar used to do only that second half, under a label promising the
  // first (critique run 16).
  const handleShowRoute = useCallback(() => {
    if (!routeResponse || !fromMarker || !toMarker) return;
    const route =
      routeResponse.routes.find((candidate: RouteResult) => candidate.routeIndex === selectedRouteIndex) ??
      routeResponse.routes[0];
    const bbox = routeBoundingBox(route, [fromMarker, ...waypoints, toMarker]);
    if (bbox) mapRef.current?.revealBoundingBox(bbox);
  }, [routeResponse, selectedRouteIndex, fromMarker, toMarker, waypoints]);

  const loadStreetViewMetadata = useCallback(
    async (id: string): Promise<Record<string, unknown> | null> => {
      if (typeof window === 'undefined') return null;
      const template = mapConfig?.streetview?.metadataUrl;
      if (!template) return null;
      const url = buildStreetViewUrl(id, template);
      if (!url) return null;
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Henting av metadata feilet (status ${response.status})`);
      }
      return (await response.json()) as Record<string, unknown>;
    },
    [mapConfig]
  );

  const handleStreetViewSelect = useCallback(
    async (event: StreetViewEventDetail) => {
      if (!streetViewLayerVisible) {
        return;
      }
      const { id, lngLat, geometry, properties } = event;
      const panoramaUrl = buildStreetViewUrl(id, mapConfig?.streetview?.panoramaUrl);
      const selection: StreetViewSelection = {
        id,
        lngLat,
        geometry,
        properties,
        panoramaUrl
      };

      setStreetViewSelection(selection);
      setStreetViewMetadata(null);
      setStreetViewError(null);
      setStreetViewLoading(false);
      setContextMenu((prev: ContextMenuState) => ({ ...prev, show: false }));
      setSelectedFeature(null);
      setHoveredFeature(null);
      // The route stays: a panorama is a look around, not a new question.

      if (!mapConfig?.streetview?.metadataUrl) {
        return;
      }

      setStreetViewLoading(true);
      try {
        const metadataResult = await loadStreetViewMetadata(id);
        setStreetViewMetadata(metadataResult);
      } catch (metadataError) {
        setStreetViewError(
          toUserMessage(metadataError, 'Kunne ikke hente informasjon om gatebildet.')
        );
        console.error('Streetview metadata fetch failed', metadataError);
      } finally {
        setStreetViewLoading(false);
      }
    },
    [loadStreetViewMetadata, mapConfig, streetViewLayerVisible]
  );

  // Whether this deployment has street view at all: it gates the layer toggle.
  const streetViewConfigured = useMemo(
    () => isStreetViewConfigured(mapConfig?.streetview),
    [mapConfig]
  );

  const handleToggleStreetViewLayer = useCallback(() => {
    if (!streetViewConfigured) return;
    setStreetViewLayerVisible((prev: boolean) => !prev);
  }, [streetViewConfigured]);

  // The layer could not load: un-press the tool and say so once, instead of
  // leaving a lit row over an empty map. Turning the layer off also stops
  // further loads, so the message cannot repeat on every pan.
  const handleStreetViewLoadError = useCallback(() => {
    setStreetViewLayerVisible(false);
    toast.warning('Kunne ikke hente gatebilder. Prøv igjen om litt.');
  }, [toast]);

  // Tiles that never arrive: say so once, and point at the way out (the
  // basemap select beside the message).
  const handleBasemapError = useCallback(
    (styleName: string) => {
      const name = styleName ? `«${styleName}»` : 'Bakgrunnskartet';
      toast.warning(`${name} er ikke tilgjengelig her. Velg et annet bakgrunnskart.`, { id: 'basemap' });
    },
    [toast]
  );

  const handleRightClick = useCallback((detail: { lng: number; lat: number; x: number; y: number }) => {
    setContextMenu({
      show: true,
      x: detail.x,
      y: detail.y,
      lngLat: { lng: detail.lng, lat: detail.lat }
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev: ContextMenuState) => ({ ...prev, show: false }));
  }, []);

  // Helper to get location name from coordinates
  const getLocationName = useCallback(async (coords: MapLngLat): Promise<string> => {
    try {
      const result = await ReverseGeocode(coords.lat, coords.lng);
      return result?.properties?.display_name || formatLatLng(coords.lat, coords.lng);
    } catch {
      return formatLatLng(coords.lat, coords.lng);
    }
  }, []);

  // Navigation mode handlers
  const handleStartNavigation = useCallback(() => {
    setNavigationMode(true);
    setSelectedFeature(null);
  }, []);

  // The rail's "Veibeskrivelse" entry: open route planning and hand focus to
  // its start field. A counter, so repeated clicks refocus.
  // Which route field to put focus in next; a new token repeats the request.
  const [stopFocus, setStopFocus] = useState<StopFocusRequest>({ field: 'from', token: 0 });
  const focusStopField = useCallback(
    (field: StopFocusRequest['field']) => setStopFocus((current) => ({ field, token: current.token + 1 })),
    []
  );
  const handleOpenDirections = useCallback(() => {
    setNavigationMode(true);
    setSelectedFeature(null);
    focusStopField('from');
  }, [focusStopField]);

  const handleCloseNavigation = useCallback(() => {
    // Everything the panel held, so "Angre" can bring the route back: closing
    // is one click and used to discard from, to, via points and avoid areas.
    const snapshot = {
      fromMarker,
      toMarker,
      waypoints,
      fromLocation,
      toLocation,
      waypointLocations,
      routingProfile,
      alternativesEnabled,
      avoidAreas
    };
    setNavigationMode(false);
    setFromLocation(null);
    setToLocation(null);
    setWaypointLocations([]);
    setFromMarker(null);
    setToMarker(null);
    setWaypoints([]);
    setRouteResponse(null);
    setRoutingStatus('idle');
    // Angre brings the route back as an answer, so it is framed again.
    framedStopsRef.current = null;
    setSelectedRouteIndex(0);
    setAlternativesEnabled(false);
    setAvoidAreas([]);
    // The next route starts from the everyday choice again; "Angre" below
    // restores the one this route used.
    setRoutingProfile('car');
    focusDirectionsOnCloseRef.current = true;
    if (snapshot.fromMarker || snapshot.toMarker || snapshot.waypoints.length > 0) {
      toast.info('Ruten er fjernet', {
        id: ROUTE_CLOSED_TOAST,
        // Shown in the rail, where the route panel was.
        inline: true,
        action: {
          label: 'Angre',
          onClick: () => {
            setNavigationMode(true);
            setFromLocation(snapshot.fromLocation);
            setToLocation(snapshot.toLocation);
            setWaypointLocations(snapshot.waypointLocations);
            setFromMarker(snapshot.fromMarker);
            setToMarker(snapshot.toMarker);
            setWaypoints(snapshot.waypoints);
            setRoutingProfile(snapshot.routingProfile);
            setAlternativesEnabled(snapshot.alternativesEnabled);
            setAvoidAreas(snapshot.avoidAreas);
            // Back in the route's first field, as opening route planning does.
            focusStopField('from');
            void computeRoute({
              from: snapshot.fromMarker,
              to: snapshot.toMarker,
              waypoints: snapshot.waypoints,
              profile: snapshot.routingProfile,
              alternatives: snapshot.alternativesEnabled,
              avoidAreas: snapshot.avoidAreas,
              // What came back is shown, not only listed.
              fit: true
            });
          }
        }
      });
    }
  }, [
    fromMarker,
    toMarker,
    waypoints,
    fromLocation,
    toLocation,
    waypointLocations,
    routingProfile,
    alternativesEnabled,
    avoidAreas,
    computeRoute,
    focusStopField,
    toast
  ]);

  // After the route panel closes, focus returns to the rail button that opens
  // it (it has just re-rendered), so keyboard users keep their place.
  useEffect(() => {
    if (navigationMode || !focusDirectionsOnCloseRef.current) return;
    focusDirectionsOnCloseRef.current = false;
    directionsButtonRef.current?.focus({ preventScroll: true });
  }, [navigationMode]);

  // One emergency exit for the rail: Escape disarms an armed map tool, else
  // closes the place card (which sits above the route panel while planning),
  // else the route panel. Surfaces with their own
  // Escape (menu, dialogs, panels) stop the event before it reaches here, and
  // text fields keep Escape for themselves.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (mapRef.current?.cancelTool()) {
        event.preventDefault();
        return;
      }
      // A pinned route detail is the most recent thing the user lit up.
      // Clear only the pin (and any preview): the profile position is a
      // separate thing the user may still have focused (e.g. the slider),
      // and Escape here must not also wipe that dot off the map.
      if (routeHighlight.pinned) {
        event.preventDefault();
        setRouteHighlight((prev) => ({ ...prev, pinned: null, preview: null }));
        return;
      }
      if (streetViewSelection) {
        event.preventDefault();
        closeStreetViewPanel();
        mapRef.current?.focus();
        return;
      }
      if (selectedFeature) {
        event.preventDefault();
        const hitIndex = selectedOverpassIndex;
        clearSelection();
        focusAfterCard(hitIndex);
        return;
      }
      if (navigationMode) {
        event.preventDefault();
        handleCloseNavigation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    navigationMode,
    selectedFeature,
    selectedOverpassIndex,
    handleCloseNavigation,
    clearSelection,
    focusAfterCard,
    streetViewSelection,
    closeStreetViewPanel,
    routeHighlight.pinned
  ]);

  // Toggle alternative-route requests on/off, re-routing immediately.
  const handleToggleAlternatives = useCallback(
    (enabled: boolean) => {
      setAlternativesEnabled(enabled);
      void computeRoute({ alternatives: enabled });
    },
    [computeRoute]
  );

  // Receives the current set of avoid-area polygons from the map's draw control.
  const handleAvoidAreasChange = useCallback(
    (areas: AvoidArea[]) => {
      setAvoidAreas(areas);
      void computeRoute({ avoidAreas: areas });
    },
    [computeRoute]
  );

  // "Fjern" in the route panel removes every drawn area; the undo waits in
  // the cleared line's own place inside the panel (see UndoNotice).
  const handleClearAvoidAreas = useCallback(() => {
    const previous = avoidAreas;
    if (previous.length === 0) return;
    handleAvoidAreasChange([]);
    toast.info(
      previous.length === 1 ? 'Området er fjernet' : `${previous.length} områder er fjernet`,
      {
        id: AVOID_AREAS_TOAST,
        // Shown in the route panel, in the cleared line's place.
        inline: true,
        action: {
          label: 'Angre',
          onClick: () => {
            handleAvoidAreasChange(previous);
            // Back on "Fjern" in the avoid-areas line, where the user just was.
            focusAfterUndo('[data-avoid-clear]');
          }
        }
      }
    );
  }, [avoidAreas, handleAvoidAreasChange, toast]);

  // An undo whose context is gone is withdrawn rather than left to act on
  // something else (critique run 13). A closed route's Angre goes once a new
  // route is begun, its first stop set from anywhere, or it would put the old
  // route back over the new one; merely opening the empty panel to look
  // begins nothing, and used to cost the undo (critique run 14). Cleared avoid
  // areas' Angre goes when the route panel closes (it would draw an area with
  // no route to avoid it) or once a new area is drawn (it would replace it).
  useEffect(() => {
    if (fromMarker || toMarker || waypoints.length > 0) toast.dismiss(ROUTE_CLOSED_TOAST);
  }, [fromMarker, toMarker, waypoints.length, toast]);
  useEffect(() => {
    if (!navigationMode || avoidAreas.length > 0) toast.dismiss(AVOID_AREAS_TOAST);
  }, [navigationMode, avoidAreas.length, toast]);

  const handleFromChange = useCallback(
    (location: LocationWithName | null) => {
      setFromLocation(location);
      setFromMarker(location?.coords || null);
      void computeRoute({ from: location?.coords || null, fit: true });
    },
    [computeRoute]
  );

  const handleToChange = useCallback(
    (location: LocationWithName | null) => {
      setToLocation(location);
      setToMarker(location?.coords || null);
      void computeRoute({ to: location?.coords || null, fit: true });
    },
    [computeRoute]
  );

  const handleWaypointsChange = useCallback(
    (locations: WaypointLocation[]) => {
      setWaypointLocations(locations);
      // Rows without a picked place are not routed through or drawn.
      const coords = resolvedWaypointCoords(locations);
      setWaypoints(coords);
      // Alternatives are only available between two points: the first
      // resolved via point switches them off for real, so the request, the
      // checkbox and the route list all say the same thing.
      const alternatives = coords.length > 0 ? false : undefined;
      if (alternatives === false) setAlternativesEnabled(false);
      void computeRoute({ waypoints: coords, alternatives, fit: true });
    },
    [computeRoute]
  );

  const handleSwapLocations = useCallback(() => {
    const tempFrom = fromLocation;
    const tempTo = toLocation;
    setFromLocation(tempTo);
    setToLocation(tempFrom);
    setFromMarker(tempTo?.coords || null);
    setToMarker(tempFrom?.coords || null);
    void computeRoute({ from: tempTo?.coords || null, to: tempFrom?.coords || null });
  }, [fromLocation, toLocation, computeRoute]);

  // Enhanced navigation handlers that also update location names
  const handleNavigateFromWithName = useCallback(
    async (lngLat: MapLngLat, name?: string) => {
      setFromMarker(lngLat);
      closeStreetViewPanel();
      const locationName = name || await getLocationName(lngLat);
      setFromLocation({ coords: lngLat, name: locationName });
      void computeRoute({ from: lngLat, fit: true });
    },
    [closeStreetViewPanel, computeRoute, getLocationName]
  );

  const handleNavigateToWithName = useCallback(
    async (lngLat: MapLngLat, name?: string) => {
      setToMarker(lngLat);
      closeStreetViewPanel();
      const locationName = name || await getLocationName(lngLat);
      setToLocation({ coords: lngLat, name: locationName });
      void computeRoute({ to: lngLat, fit: true });
    },
    [closeStreetViewPanel, computeRoute, getLocationName]
  );

  const handleAddWaypointWithName = useCallback(
    async (lngLat: MapLngLat, name?: string) => {
      const locationName = name || await getLocationName(lngLat);
      setWaypointLocations((prev) => [...prev, { coords: lngLat, name: locationName }]);
      // A via point ends alternatives (see handleWaypointsChange).
      setAlternativesEnabled(false);
      setWaypoints((prev: MapLngLat[]) => {
        const next = [...prev, lngLat];
        void computeRoute({ waypoints: next, alternatives: false, fit: true });
        return next;
      });
      closeStreetViewPanel();
    },
    [closeStreetViewPanel, computeRoute, getLocationName]
  );

  // Debounced permalink write; reads the latest state through writeHashRef.
  const scheduleHashWrite = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (hashTimerRef.current !== null) window.clearTimeout(hashTimerRef.current);
    hashTimerRef.current = window.setTimeout(() => {
      hashTimerRef.current = null;
      writeHashRef.current();
    }, 400);
  }, []);

  // Receives live view (zoom + center) from Leaflet move/zoom events.
  const handleViewChange = useCallback(
    (view: { zoom: number; lat: number; lng: number }) => {
      mapViewRef.current = view;
      scheduleHashWrite();
    },
    [scheduleHashWrite]
  );

  // Receives base-style changes (by id) from the Map style selector.
  const handleStyleChange = useCallback((styleId: string) => {
    setActiveStyleId(styleId);
  }, []);

  // Write view/style/route into the URL hash, debounced, using replaceState so
  // we don't pollute the browser back-stack. A guard ref ensures the hash we
  // write programmatically (e.g. during restore) doesn't echo back as a change.
  useEffect(() => {
    writeHashRef.current = () => {
      if (!configLoaded || typeof window === 'undefined') return;
      const state: MapHashState = {};
      const mapView = mapViewRef.current;
      if (mapView) {
        state.view = { zoom: mapView.zoom, lat: mapView.lat, lng: mapView.lng };
      }
      if (activeStyleId) {
        state.style = activeStyleId;
      }
      // A route exists only when both endpoints are set.
      if (fromMarker && toMarker) {
        state.route = [fromMarker, ...waypoints, toMarker].map((p) => ({
          lat: p.lat,
          lng: p.lng
        }));
      }
      if (streetViewLayerVisible) {
        state.streetview = true;
      }

      const nextHash = serializeMapHash(state);
      const currentHash = window.location.hash;
      // Skip the one write triggered by restoring from the hash, and any no-op.
      if (hashWriteGuardRef.current) {
        hashWriteGuardRef.current = false;
        return;
      }
      if (nextHash === currentHash || (nextHash === '' && currentHash === '')) {
        return;
      }
      const url = `${window.location.pathname}${window.location.search}${nextHash}`;
      window.history.replaceState(window.history.state, '', url);
    };
  });

  // Style/route changes schedule a write; view changes do so via handleViewChange.
  useEffect(() => {
    if (!configLoaded) return;
    scheduleHashWrite();
  }, [
    configLoaded,
    activeStyleId,
    fromMarker,
    toMarker,
    waypoints,
    streetViewLayerVisible,
    scheduleHashWrite
  ]);

  useEffect(
    () => () => {
      if (hashTimerRef.current !== null) window.clearTimeout(hashTimerRef.current);
    },
    []
  );

  // Systemhelse is for operators, not for the staff who use the map: it stays
  // off the default screen. `?health` in the URL shows its button (top-right,
  // beside the layer button) and Alt+Shift+H toggles the panel without it;
  // HEALTH_DASHBOARD_ENABLED remains the master switch for both.
  const healthEnabled = mapConfig?.healthDashboardEnabled !== false;
  const healthButtonVisible = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('health'),
    []
  );
  useEffect(() => {
    if (!healthEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === 'KeyH') {
        event.preventDefault();
        setHealthDashboardOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [healthEnabled]);
  const healthButton =
    healthEnabled && healthButtonVisible ? (
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-default bg-surface-default shadow-sm transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
        onClick={() => setHealthDashboardOpen((prev) => !prev)}
        onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
          // Escape closes the panel from its toggle too, not only from inside it.
          if (event.key === 'Escape' && healthDashboardOpen) {
            event.stopPropagation();
            setHealthDashboardOpen(false);
          }
        }}
        aria-expanded={healthDashboardOpen}
        title="Systemhelse"
        aria-label="Vis/skjul systemhelse"
      >
        <svg
          className="h-5 w-5 text-text-subtle"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 12h4l2-6 4 12 2-6h6" />
        </svg>
      </button>
    ) : null;

  // Show loading state while config is loading
  if (!configLoaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background-default">
        <div className="text-center">
          <div
            className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-border-default"
            // Accent follows config.theme.primary (--app-primary) when set,
            // falling back to the design system's base token otherwise.
            style={{ borderTopColor: 'var(--app-primary, var(--mtds-color-base-default))' }}
          />
          <p className="mt-4 text-text-subtle">Laster kart…</p>
        </div>
      </div>
    );
  }

  // A place card sharing the rail with a list worth comparing — a hit's card
  // or one asked about on the map, over more than one hit — folds its facts
  // and lets the list hold a taller floor, because the rows are what the user
  // is comparing (critique run 8, extended to the map path in run 9). A route
  // panel cannot fold its fields away, so the list yields to it as before.
  // This decides the card's fold and the list's floor, nothing else: the
  // results header asks its own question (does any panel share the rail?),
  // because while this one flag also decided the header, a one-hit list kept
  // its full 119px header in a 144px floor and showed 23px of its only row
  // (critique run 11).
  const cardSharesList = selectedFeature !== null && overpassFeatures.length > 1;

  // The card and, while planning, the route panel. It always sits above the
  // area-search results, in the place of the Veibeskrivelse button it
  // replaces, and it is rendered in ONE place. Rendered in two slots, every
  // card that opened or closed remounted it: that re-ran its failure scroll,
  // leaving a card 0px visible with focus on its hidden name; it wiped a
  // destination typed but not yet picked; and it reset its scroll. Moving the
  // node would reset the scroll of whatever moved and blur any focus inside it
  // (measured, critique run 12). A route panel alone once sat BELOW the list
  // through CSS `order`, which made Tab run down to the panel and back up to
  // the list against what is seen (critique run 13). Always above, the DOM
  // matches the screen in every state, and appearing before the list never
  // touches the list's scroll.
  const sidebarPanel =
    selectedFeature || routeFeature || navigationMode ? (
    // self-start: shrink to the SideBar's width (~320px) instead of
    // stretching to the 512px rail — otherwise the invisible extra width
    // is pointer-events-auto and swallows map right-clicks beside the panel.
    // No flex-1: the panel sizes to its content and scrolls inside the
    // rail instead of stretching an empty white card over the map. Beside a
    // hit list it takes at most 55% of the rail: a settled route is one
    // answer, the list is the comparison being made, and on a tall screen
    // every extra pixel went to the route while the list sat at its floor of
    // two rows of fourteen (critique run 15). On short rails the list's own
    // floor already binds first, so nothing changes there. The cap stands
    // down while a card's facts are unfolded: reading them is a request for
    // the card to outrank the list, and capped it showed 350px of 577
    // (decided run 10, measured again in polish 15).
    <div
      className={`pointer-events-auto flex min-h-0 self-start ${
        overpassFeatures.length > 0 && !cardFactsOpen ? 'max-h-[55%]' : ''
      }`}
    >
      <SideBar
        focusOnOpen={selectedFeatureFocus}
        feature={selectedFeature}
        featureNote={selectedFeatureNote}
        onRetryFeature={featureRetryAt ? () => mapRef.current?.lookupAt(featureRetryAt) : undefined}
        routeProfile={routeProfile}
        routeFeature={routeFeature}
        routes={routeResponse?.routes ?? null}
        routingStatus={routingStatus}
        routingErrorMessage={routingError}
        selectedRouteIndex={selectedRouteIndex}
        onSelectRoute={setSelectedRouteIndex}
        onRetryRoute={() => void computeRoute()}
        onShowRoute={handleShowRoute}
        routeVisibility={routeVisibility}
        routeHighlight={routeHighlight}
        onRouteHighlightChange={setRouteHighlight}
        alternativesEnabled={alternativesEnabled}
        onToggleAlternatives={handleToggleAlternatives}
        avoidAreasCount={avoidAreas.length}
        onClearAvoidAreas={handleClearAvoidAreas}
        navigationMode={navigationMode}
        focusStop={stopFocus}
        fromLocation={fromLocation}
        toLocation={toLocation}
        waypointLocations={waypointLocations}
        routingProfile={routingProfile}
        isSaved={isFeatureSaved(selectedFeature)}
        onToggleSaved={selectedFeature ? handleToggleSaved : undefined}
        compact={cardSharesList}
        onExpandedChange={setCardFactsOpen}
        onClose={() => {
          if (selectedFeature) {
            const hitIndex = selectedOverpassIndex;
            clearSelection();
            focusAfterCard(hitIndex);
          } else {
            // A route shown without its panel closes the way the panel does.
            handleCloseNavigation();
          }
        }}
        onJumpTo={(coords: MapLngLat) => mapRef.current?.jumpToCoordinates(coords)}
        // A stop set from the place card closes the card: the question
        // has become part of the route.
        // The card's button goes with the card, so focus moves on to the route:
        // the next stop still to fill, else the one just filled, or the new via
        // row. It used to fall on the page (critique run 13).
        onNavigateFrom={(lngLat: MapLngLat) => {
          const featureName = selectedFeature?.properties?.display_name;
          clearSelection();
          void handleNavigateFromWithName(lngLat, featureName);
          focusStopField(toLocation ? 'from' : 'to');
        }}
        onAddWaypoint={(lngLat: MapLngLat) => {
          const featureName = selectedFeature?.properties?.display_name;
          clearSelection();
          void handleAddWaypointWithName(lngLat, featureName);
          focusStopField('via');
        }}
        onNavigateTo={(lngLat: MapLngLat) => {
          const featureName = selectedFeature?.properties?.display_name;
          clearSelection();
          void handleNavigateToWithName(lngLat, featureName);
          focusStopField(fromLocation ? 'to' : 'from');
        }}
        onStartNavigation={handleStartNavigation}
        onFromChange={handleFromChange}
        onToChange={handleToChange}
        onWaypointsChange={handleWaypointsChange}
        onProfileChange={(profile: RoutingProfile) => {
          setRoutingProfile(profile);
          void computeRoute({ profile });
        }}
        onSwapLocations={handleSwapLocations}
        onCloseNavigation={handleCloseNavigation}
      />
    </div>
    ) : null;

  return (
    <div
      className={`relative h-screen w-screen overflow-clip bg-background-default ${
        streetViewSelection ? 'streetview-panel-open' : ''
      }`}
    >
      {/*
        Left rail: search box → results dropdown → SideBar form a single,
        non-overlapping vertical flow anchored to the left edge. Using normal
        flex-column stacking (instead of each piece anchoring independently to
        left-8/top-8/top-24) stops the SearchBar/results/SideBar collision.
        `pointer-events-none` lets map interactions through the empty gaps;
        children re-enable pointer events. Widths are unchanged (desktop only).
        The rail comes before the map in the DOM so Tab reaches the search
        field first; z-index tiers keep it above the map regardless.
      */}
      {/* The page's one title, for the heading outline; every panel is an h2. */}
      <h1 className="sr-only">OpenMaps</h1>
      <div
        data-rail=""
        className="pointer-events-none absolute inset-y-8 left-8 z-panel flex w-full max-w-lg flex-col gap-3"
      >
        <div className="pointer-events-auto">
          <SearchBar
            mapRef={mapRef}
            inputRef={searchInputRef}
            onSelect={handleSearchSelect}
            onHover={handleHover}
            onUnhover={handleUnhover}
            onClear={handleClear}
            onOverpassResults={handleOverpassResults}
            savedPlaces={savedPlaces}
            recentPlaces={recentPlaces}
            onClearRecent={handleClearRecent}
            showMapHint={!selectedFeature && !navigationMode && overpassFeatures.length === 0}
            areaQuestion={overpassFeatures.length > 0 ? overpassMeta?.query : undefined}
          />
        </div>

        {!navigationMode && (
          // The second everyday job gets a visible entry under the first;
          // routing used to be reachable only by right-clicking the map.
          <div className="pointer-events-auto self-start">
            <button
              ref={directionsButtonRef}
              type="button"
              onClick={handleOpenDirections}
              className="flex h-10 items-center gap-2 rounded-lg border border-border-default bg-surface-default px-3 text-sm font-medium text-text-default shadow-sm transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
            >
              <svg
                className="h-5 w-5 shrink-0 text-text-subtle"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="6" cy="18" r="2.5" />
                <circle cx="18" cy="6" r="2.5" />
                <path d="M8.5 18H14a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5.5" />
              </svg>
              Veibeskrivelse
            </button>
          </div>
        )}

        {/* A closed route waits to come back where it stood: under the search
            field, in the place its panel had. */}
        <UndoNotice subject="route-closed" surface="card" className="pointer-events-auto" />

        {/* The panel docks ABOVE the results list, always: a card answers a
            point and a route panel takes the Veibeskrivelse button's place, both
            under the search field; the list stays under them, and the DOM order
            is the order seen (see sidebarPanel). */}
        {sidebarPanel}

        {overpassFeatures.length > 0 && (
          // The answer to "Hva finnes i kartutsnittet?" docks under the question, like the
          // details card and the route panel; a hit's card docks above it.
          // With a card or the route panel open, that panel leads: the list
          // gives up its height first, and only then does the panel scroll
          // inside itself. It never gives up so much that the hits stop being
          // comparable, though: with more than one hit it holds its header and
          // three rows, which is what the card going compact pays for.
          <div
            className={`pointer-events-auto flex self-start ${
              sidebarPanel
                ? `shrink-[1000] ${
                    cardSharesList
                      ? cardFactsOpen
                        ? // Reading the facts: the list keeps its header and
                          // one whole row — the list scrolls the open hit into
                          // view, so that row is the place being read about —
                          // and the card takes the rest. 8rem left a sliver
                          // rather than a row (measured, run 10).
                          'min-h-[min(9rem,25%)]'
                        : 'min-h-[min(18rem,50%)]'
                      : overpassFeatures.length > 1
                        ? 'min-h-[min(12.5rem,33%)]'
                        : // One hit: the folded header (57px) and its row
                          // (71px) fit in 9rem with room to spare.
                          'min-h-[min(9rem,33%)]'
                  }`
                : 'min-h-0'
            }`}
          >
            <OverpassResults
              features={overpassFeatures}
              query={overpassMeta?.query}
              generator={overpassMeta?.generator}
              overpassQuery={overpassMeta?.overpassQuery}
              hiddenCount={hiddenHitCount}
              onShowAll={handleShowAllHits}
              selectedIndex={selectedOverpassIndex}
              sharesRail={sidebarPanel !== null}
              onSelectFeature={handleOverpassSelect}
              onHighlightFeature={(index: number | null) => mapRef.current?.highlightOverpassFeature(index)}
              onClose={() => {
                // An area answer can cost a minute of inference, and this was
                // the last destructive one-click here without an undo — the
                // route, recent searches and avoid areas all have one
                // (critique run 10).
                const previousFeatures = overpassFeatures;
                const previousMeta = overpassMeta;
                if (selectedOverpassIndex !== null) clearSelection();
                setOverpassFeatures([]);
                searchInputRef.current?.focus({ preventScroll: true });
                toast.info(
                  previousMeta?.query
                    ? `Treffene for «${previousMeta.query}» er fjernet`
                    : 'Treffene er fjernet',
                  {
                    id: AREA_RESULTS_TOAST,
                    // Shown in the rail, where the list was.
                    inline: true,
                    action: {
                      label: 'Angre',
                      onClick: () => {
                        setOverpassFeatures(previousFeatures);
                        setOverpassMeta(previousMeta);
                        // What came back is shown, not only listed, as a
                        // route's Angre does: the map may have been taken far
                        // from these hits since they were closed.
                        frameHits(mapRef.current, previousFeatures);
                        focusAfterUndo('[data-overpass-row="0"]');
                      }
                    }
                  }
                );
              }}
            />
          </div>
        )}

        {/* A closed answer waits in the list's own place, under the question
            that produced it. */}
        <UndoNotice subject="area-results" surface="card" className="pointer-events-auto" />
      </div>


      <Map
        ref={mapRef}
        config={mapConfig}
        mapStyles={mapStyles}
        zoom={mapZoom}
        center={mapCenter}
        initialStyleId={activeStyleId}
        onViewChange={handleViewChange}
        onStyleChange={handleStyleChange}
        selectedFeature={selectedFeature}
        hoveredFeature={hoveredFeature}
        routeFeature={routeFeature}
        routeHighlight={routeHighlightGeometry}
        avoidAreas={avoidAreas}
        onAvoidAreasChange={handleAvoidAreasChange}
        onSelectAlternative={setSelectedRouteIndex}
        overpassFeatures={overpassFeatures}
        // Only while the answer stands: closing the list keeps its meta for
        // Angre, and a box around nothing would be a question with no answer.
        areaExtent={overpassFeatures.length > 0 ? (overpassMeta?.bbox ?? null) : null}
        onOverpassVisibilityChange={setHiddenHitCount}
        onRouteVisibilityChange={setRouteVisibility}
        selectedOverpassIndex={selectedOverpassIndex}
        onOverpassSelect={handleOverpassSelect}
        fromMarker={fromMarker}
        toMarker={toMarker}
        waypoints={waypoints}
        streetViewVisible={streetViewLayerVisible}
        onToggleStreetView={handleToggleStreetViewLayer}
        onStreetViewLoadError={handleStreetViewLoadError}
        onBasemapError={handleBasemapError}
        navigationMode={navigationMode}
        topRightSlot={healthButton}
        onSelect={handleMapSelect}
        onRightClick={handleRightClick}
        onStreetViewSelect={handleStreetViewSelect}
        onUpdateFromMarker={(lngLat: MapLngLat) => {
          setFromMarker(lngLat);
          void computeRoute({ from: lngLat });
          // Re-resolve the address so the sidebar reflects the dragged location.
          void getLocationName(lngLat).then((name) => setFromLocation({ coords: lngLat, name }));
        }}
        onUpdateToMarker={(lngLat: MapLngLat) => {
          setToMarker(lngLat);
          void computeRoute({ to: lngLat });
          void getLocationName(lngLat).then((name) => setToLocation({ coords: lngLat, name }));
        }}
        onUpdateWaypoints={(nextWaypoints: MapLngLat[]) => {
          setWaypoints(nextWaypoints);
          void computeRoute({ waypoints: nextWaypoints });
          // Re-resolve only the waypoint(s) that moved; keep the others' names.
          void reconcileWaypointLocations(waypointLocations, nextWaypoints, getLocationName).then(
            setWaypointLocations
          );
        }}
      />

      {streetViewSelection && (
        <StreetViewPanel
          selection={streetViewSelection}
          metadata={streetViewMetadata}
          loadingMetadata={streetViewLoading}
          error={streetViewError}
          onClose={closeStreetViewPanel}
          restoreFocus={() => mapRef.current?.focus()}
        />
      )}

      {contextMenu.show && (
        <>
          <button
            type="button"
            tabIndex={-1}
            className="fixed inset-0 z-panel cursor-default bg-transparent"
            onClick={closeContextMenu}
            aria-label="Lukk kontekstmeny"
          />
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            lngLat={contextMenu.lngLat}
            onClose={closeContextMenu}
            onWhatIsHere={(lngLat: MapLngLat) => {
              closeContextMenu();
              mapRef.current?.lookupAt(lngLat);
            }}
            onCopyCoordinates={(lngLat: MapLngLat) => {
              closeContextMenu();
              const text = formatLatLng(lngLat.lat, lngLat.lng);
              void copyText(text).then((ok) => {
                if (ok) toast.success('Koordinatene er kopiert', { id: 'copy' });
                else toast.warning(`Kunne ikke kopiere. Koordinatene er ${text}.`, { id: 'copy' });
              });
            }}
            onNavigateFrom={(lngLat: MapLngLat) => {
              closeContextMenu();
              setNavigationMode(true);
              void handleNavigateFromWithName(lngLat);
            }}
            onAddWaypoint={(lngLat: MapLngLat) => {
              closeContextMenu();
              setNavigationMode(true);
              void handleAddWaypointWithName(lngLat);
            }}
            onNavigateTo={(lngLat: MapLngLat) => {
              closeContextMenu();
              setNavigationMode(true);
              void handleNavigateToWithName(lngLat);
            }}
          />
        </>
      )}

      {/* Systemhelse panel (opened from the ?health button or Alt+Shift+H) */}
      {healthEnabled && healthDashboardOpen && (
        <HealthDashboard onClose={() => setHealthDashboardOpen(false)} />
      )}
    </div>
  );
};

export default App;
