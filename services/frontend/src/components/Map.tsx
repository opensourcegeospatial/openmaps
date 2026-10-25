import LayersIcon from './LayersIcon';
import { toUserMessage } from '../lib/errors';
import React, { forwardRef, useRef, useState, useEffect, useCallback } from 'react';
import L, { LeafletMouseEvent, LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { Feature, FeatureCollection, Geometry, GeoJsonObject } from 'geojson';
import type { GeoJSONFeature } from '../lib/nominatim';
import { ReverseGeocode } from '../lib/nominatim';
import { OSM_CREDIT, plainAttribution } from '../lib/attribution';
import { resolveFeatureView } from '../lib/featureView';
import { escapeHtml } from '../lib/html';
import { getDisplayName } from '../lib/overpassFeature';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import type { RouteFeatureCollection } from '../lib/graphhopper';
import type { MapConfig } from '../config/map.config';
import type { MapStyle } from '../lib/mapStyles';
import { defaultMapStyles } from '../lib/mapStyles';
import { loadStoredLayers, serializeLayersForStorage, STORED_LAYERS_KEY } from '../lib/customLayers';
import { buildFileVectorLayer } from '../lib/fileLayer';
import { finalizeMeasurementPoints } from '../lib/measure';
import {
  formatMeasuredDistance as formatDistance,
  formatMeasuredArea as formatArea, formatLatLng } from '../lib/format';
import { isStreetViewConfigured, streetViewCoverage, type StreetViewCoverage } from '../lib/streetViewLayer';
import type { RouteHighlightGeometry } from '../lib/routeDetails';

/** What the Gatebilde row says while the layer is on but draws nothing. */
const STREETVIEW_HINTS: Record<Exclude<StreetViewCoverage, 'ok'>, string> = {
  'zoom-in': 'Zoom inn for å se gatebilder.',
  'zoom-out': 'Zoom ut for å se gatebilder.',
  outside: 'Ingen gatebilder i dette området.'
};
/** What the Gatebilde row says while points are drawn: the pointer and the key. */
const STREETVIEW_KEYBOARD_HINT = 'Klikk på et punkt, eller trykk Enter på kartet for bildet nærmest midten.';
import { PendingLoads } from '../lib/pendingLoads';
import { applyVectorLayerOpacity, effectiveLayerOpacity } from '../lib/layerOpacity';
import LayerManager, { type CustomLayerConfig, type OGCServiceConfig, type FileLayerConfig, type XYZLayerConfig } from './LayerManager';
import { useToast } from './toast';
import MapTools from './MapTools';
import { setToastClearance } from '../lib/toastClearance';
import { mapColors } from '../lib/mapColors';

// Fix Leaflet default marker icon paths - use local files for offline support
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/images/markers/marker-icon-2x.png',
  iconUrl: '/images/markers/marker-icon.png',
  shadowUrl: '/images/markers/marker-shadow.png',
});

export type MapLngLat = { lng: number; lat: number };

/**
 * Watch a basemap's tiles. A basemap whose tiles never arrive would otherwise
 * leave a blank canvas — the one failure this product never named (critique
 * run 7). Four failed tiles with none loaded is a service that is not there;
 * a single miss at the edge of a zoom level is not, so that stays quiet.
 */
function watchBasemapTiles(layer: L.TileLayer, report: () => void): void {
  let failed = 0;
  let loaded = 0;
  let reported = false;
  layer.on('tileload', () => {
    loaded += 1;
  });
  layer.on('tileerror', () => {
    failed += 1;
    if (reported || loaded > 0 || failed < 4) return;
    reported = true;
    report();
  });
}

/** How much of the drawn route the current view shows. */
export type RouteVisibility = 'whole' | 'partial' | 'none';

export interface MapHandle {
  jumpToBoundingBox: (bbox: [number, number, number, number]) => void;
  /**
   * Bring a box wholly into the map's clear frame (right of the rail, inside
   * the controls), fitting to it only when some of it lies outside: a route
   * planned where the user is already looking leaves the view alone.
   */
  revealBoundingBox: (bbox: [number, number, number, number]) => void;
  jumpToFeature: (feature: GeoJSONFeature) => void;
  /**
   * Bring an area-search hit into view when the rail or the panels hide it:
   * the map pans only as far as needed and never changes zoom.
   */
  revealOverpassFeature: (index: number) => void;
  /** Lift one numbered hit on the map (or none), following the hovered or focused row. */
  highlightOverpassFeature: (index: number | null) => void;
  jumpToCoordinates: (coords: MapLngLat) => void;
  clearFeature: () => void;
  project: (coord: MapLngLat) => { x: number; y: number };
  getBounds: () => { north: number; south: number; east: number; west: number } | null;
  fitBounds: (bounds: [[number, number], [number, number]], options?: { padding?: number }) => void;
  /** Disarm an armed measuring or avoid-area tool; true when something was armed. */
  cancelTool: () => boolean;
  /** Remove the finished measurement: its line, popup and readout. */
  clearMeasurement: () => void;
  /** Ask "what is here?" at a point: look up its address and open the card. */
  lookupAt: (coords: MapLngLat) => void;
  /** Put keyboard focus on the map. */
  focus: () => void;
}

export interface StreetViewEventDetail {
  id: string;
  lngLat: MapLngLat;
  geometry?: Geometry | null;
  properties: Record<string, unknown>;
}

export interface MeasurementResult {
  type: 'distance' | 'area';
  value: number;
  unit: string;
  coordinates: [number, number][];
}

export interface MapProps {
  config: MapConfig | null;
  mapStyles: MapStyle[];
  zoom: number;
  center: MapLngLat;
  /** Base-style id to apply on init (restored from the URL hash). */
  initialStyleId?: string | null;
  selectedFeature: GeoJSONFeature | null;
  hoveredFeature: GeoJSONFeature | null;
  routeFeature: RouteFeatureCollection | null;
  /** What the route details point at: a dot on the route and/or stretches of it. */
  routeHighlight?: RouteHighlightGeometry | null;
  /** Avoid-area polygons (rings of [lng,lat]) drawn by the user. */
  avoidAreas: [number, number][][];
  overpassFeatures: GeoJSONFeature[];
  /**
   * The extent the area search asked about, as [west, south, east, north],
   * drawn as a hairline while its answer stands. "Hva finnes i kartutsnittet?"
   * names a rectangle; until run 16 the rectangle was never on the map.
   */
  areaExtent?: [number, number, number, number] | null;
  /**
   * How many of the numbered hits are outside the current view. Reported on
   * every pan and zoom so the list can say so and offer the way back: a drag
   * used to leave fourteen confident rows over an empty map (critique run 16).
   */
  onOverpassVisibilityChange?: (hiddenCount: number) => void;
  /**
   * How much of the route the view shows, reported like the hits: a route
   * framed on arrival can still be panned away from, and the panel needs to
   * know to offer the way back.
   */
  onRouteVisibilityChange?: (visibility: RouteVisibility) => void;
  /** The area-search hit whose card is open; its dot is drawn selected. */
  selectedOverpassIndex?: number | null;
  /** A hit's dot or area was clicked on the map. */
  onOverpassSelect?: (index: number) => void;
  fromMarker: MapLngLat | null;
  toMarker: MapLngLat | null;
  waypoints: MapLngLat[];
  streetViewVisible: boolean;
  /** True while a route is being planned; shows the avoid-area tool. */
  navigationMode?: boolean;
  /** Rendered first in the top-right control row (operator-only controls). */
  topRightSlot?: React.ReactNode;
  /**
   * A place was picked on the map. `note` carries what the card should say
   * when the point could not be turned into an address (the feature then
   * holds only the coordinates).
   */
  /**
   * A place to show in the card. `retry` says the answer is a failure the card
   * can ask again ("Prøv igjen" re-runs the lookup at the same point).
   */
  onSelect?: (
    feature: GeoJSONFeature,
    note?: string,
    options?: { focus?: boolean; retry?: boolean }
  ) => void;
  onRightClick?: (evt: { lng: number; lat: number; x: number; y: number }) => void;
  onStreetViewSelect?: (evt: StreetViewEventDetail) => void;
  onToggleStreetView?: () => void;
  /** The panorama point layer failed to load; the parent un-presses the tool. */
  onStreetViewLoadError?: () => void;
  /** The basemap's tiles do not arrive: nothing answers at that URL from here. */
  onBasemapError?: (styleName: string) => void;
  onUpdateFromMarker?: (lngLat: MapLngLat) => void;
  onUpdateToMarker?: (lngLat: MapLngLat) => void;
  onUpdateWaypoints?: (waypoints: MapLngLat[]) => void;
  onMeasurementComplete?: (measurement: MeasurementResult) => void;
  /** Fired with the full set of avoid-area polygons after a draw/clear. */
  onAvoidAreasChange?: (areas: [number, number][][]) => void;
  /** Fired when the user clicks an alternative route (its route_index). */
  onSelectAlternative?: (routeIndex: number) => void;
  /** Fired (after move/zoom) with the current view, for URL-hash syncing. */
  onViewChange?: (view: { zoom: number; lat: number; lng: number }) => void;
  /** Fired when the base style changes, with the selected style id. */
  onStyleChange?: (styleId: string) => void;
}

const createEmptyCollection = (): FeatureCollection<Geometry> => ({
  type: 'FeatureCollection',
  features: []
});

function toFeatureCollection(feature: GeoJSONFeature | null): FeatureCollection<Geometry> {
  if (!feature) {
    return createEmptyCollection();
  }
  return {
    type: 'FeatureCollection',
    features: [feature as Feature<Geometry>]
  };
}

// Route stops wear the same marks as their rows in the route panel: a hollow
// Fjord Teal ring for the start, a numbered Survey Blue badge for a via point
// and a solid Rust Red dot for the destination, each on a white halo so it stays
// findable on busy tiles (see .route-stop in app.css). Built when a marker is
// made, so a deployment's theme colours apply; the label is an integer.
function stopIcon(kind: 'from' | 'via' | 'to', label = ''): L.DivIcon {
  const style =
    kind === 'from'
      ? `border-color:${mapColors.markerFrom}`
      : kind === 'via'
        ? `background-color:${mapColors.markerWaypoint};color:${mapColors.pointHalo}`
        : `background-color:${mapColors.markerTo}`;
  return L.divIcon({
    className: `route-stop route-stop--${kind}`,
    html: `<span style="${style}">${label}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

// Helper to calculate geodesic distance
function calculateGeodesicDistance(latlngs: L.LatLng[]): number {
  let total = 0;
  for (let i = 0; i < latlngs.length - 1; i++) {
    total += latlngs[i].distanceTo(latlngs[i + 1]);
  }
  return total;
}

// Helper to calculate area (using Leaflet.GeometryUtil if available, otherwise approximation)
function calculateSphericalArea(latlngs: L.LatLng[]): number {
  if (latlngs.length < 3) return 0;
  // Use L.GeometryUtil.geodesicArea if available (from leaflet-draw)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((L as any).GeometryUtil && typeof (L as any).GeometryUtil.geodesicArea === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (L as any).GeometryUtil.geodesicArea(latlngs);
  }
  // Fallback: simple planar area calculation
  let area = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const j = (i + 1) % latlngs.length;
    area += latlngs[i].lng * latlngs[j].lat;
    area -= latlngs[j].lng * latlngs[i].lat;
  }
  return Math.abs(area / 2) * 111319.9 * 111319.9; // Approximate conversion to square meters
}

/**
 * The part of the map an answer is fitted into: right of the rail (search,
 * cards and lists) and clear of the map's own controls, as padding for
 * fitBounds. A flat 50px left the first hits under the search card and the
 * results list — 2 of 14 at 1280x720, 4 at 1440x900 — so the numbered dots the
 * list points at were the ones hidden (critique run 15).
 */
function answerFramePadding(): { paddingTopLeft: [number, number]; paddingBottomRight: [number, number] } {
  const rail = document.querySelector('[data-rail]')?.getBoundingClientRect();
  return {
    paddingTopLeft: [Math.round((rail?.right ?? 50) + 32), 96],
    paddingBottomRight: [96, 64]
  };
}

/**
 * Fit an answer's box, [west, south, east, north], into that frame. maxZoom,
 * because an answer can have no extent at all: one hit, or a route whose two
 * stops snapped to the same point, gives a degenerate box that would otherwise
 * fit to the map's deepest zoom. 18 is the street-level ceiling jumpToFeature
 * already uses.
 */
function fitAnswer(map: L.Map, bbox: [number, number, number, number]): void {
  map.fitBounds(
    [
      [bbox[1], bbox[0]],
      [bbox[3], bbox[2]]
    ],
    { ...answerFramePadding(), maxZoom: 18 }
  );
}

/**
 * Whether the drawn route (its line, alternatives and the connectors to its
 * stops) lies wholly, partly or not at all inside `bounds`. "none" is claimed
 * only when the route's box misses the view, so it can never be said of a
 * route the user can see; an L-shaped route whose box crosses the view counts
 * as "partial", which is still true.
 */
function routeVisibility(layer: L.GeoJSON | null, bounds: L.LatLngBounds): RouteVisibility {
  const routeBounds = layer?.getBounds();
  if (!routeBounds || !routeBounds.isValid()) return 'whole';
  if (bounds.contains(routeBounds)) return 'whole';
  return bounds.intersects(routeBounds) ? 'partial' : 'none';
}

/**
 * How many numbered hits lie outside `bounds`. The numbers are what the list
 * and the map share, so a hit counts where its number is drawn: at the point,
 * or at an area's centre.
 */
function countHiddenHits(markers: Map<number, L.Marker>, bounds: L.LatLngBounds): number {
  let hidden = 0;
  markers.forEach((marker) => {
    if (!bounds.contains(marker.getLatLng())) hidden += 1;
  });
  return hidden;
}

/**
 * Route line styles. While route details light some stretches, the route
 * dims so they stand out; the values are explicit (not multiplied) so they
 * stay exact in the SVG.
 */
function routeStyle(feature: Feature | undefined, dimmed: boolean): L.PathOptions {
  const style = feature?.properties?.style;
  if (style === 'dashed') {
    // Connector segment from the click point to the snapped point.
    return { color: mapColors.routeConnector, weight: 6, opacity: dimmed ? 0.3 : 0.8, dashArray: '10, 10' };
  }
  if (style === 'alternative') {
    // Greyed/dashed secondary route, drawn beneath the primary.
    return { color: mapColors.routeAlternative, weight: 5, opacity: dimmed ? 0.25 : 0.7, dashArray: '8, 8' };
  }
  // Primary (selected) route — highlighted, solid.
  return { color: mapColors.routePrimary, weight: 6, opacity: dimmed ? 0.35 : 0.9 };
}

const MapComponent = forwardRef<MapHandle, MapProps>((props: MapProps, ref: React.Ref<MapHandle>) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fromMarkerRef = useRef<L.Marker | null>(null);
  const toMarkerRef = useRef<L.Marker | null>(null);
  const waypointMarkersRef = useRef<L.Marker[]>([]);
  // Tool state mirrored into refs for Leaflet's long-lived click handler,
  // which must read the current value without being re-bound.
  const measureModeRef = useRef<'none' | 'distance' | 'area'>('none');
  const avoidDrawingRef = useRef(false);
  const propsRef = useRef<MapProps>(props);
  // Toast API, mirrored into a ref so long-lived Leaflet event handlers and the
  // custom-layer effect can surface user-facing errors without stale closures
  // or being forced into their dependency arrays.
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // Aborts an in-flight reverse-geocode when a newer map click arrives.
  const reverseGeocodeAbortRef = useRef<AbortController | null>(null);
  // The one "what is here?" lookup, shared by a click, Enter and the menu.
  const lookupAtRef = useRef<((lat: number, lng: number) => Promise<void>) | null>(null);
  // The dot that marks a point while its address is being looked up.
  const pendingLookupRef = useRef<L.CircleMarker | null>(null);
  // Panorama points currently drawn, so Enter on the map can open the nearest.
  const streetViewPointsRef = useRef<StreetViewEventDetail[]>([]);

  const [mapLoaded, setMapLoaded] = useState(false);

  // Layer refs
  const hoveredLayerRef = useRef<L.GeoJSON | null>(null);
  const selectedLayerRef = useRef<L.GeoJSON | null>(null);
  const routeLayerRef = useRef<L.GeoJSON | null>(null);
  const routeHighlightRef = useRef<L.LayerGroup | null>(null);
  // Read by the route layer's style when it is rebuilt, so a rebuilt route
  // keeps the dimming while stretches are lit.
  const routeDimmedRef = useRef(false);
  const overpassLayerRef = useRef<L.GeoJSON | null>(null);
  const areaExtentRef = useRef<L.Rectangle | null>(null);
  // True between movestart and moveend. A fit animates, and until it lands
  // getBounds() still answers with the view it is leaving: an answer restored
  // by Angre over a map the user had panned away would report every hit hidden,
  // flash that note and announce it, then retract it a quarter-second later.
  const movingRef = useRef(false);
  // Maps an overpass feature's index (in props.overpassFeatures) to its rendered
  // Leaflet sub-layer, so the sidebar can imperatively open a feature's popup.
  const overpassSubLayersRef = useRef<Map<number, L.Layer>>(new globalThis.Map());
  // The numbered dot for each hit (the marker itself, or a label at an area's centre).
  const overpassNumberRef = useRef<Map<number, L.Marker>>(new globalThis.Map());
  const streetViewLayerRef = useRef<L.LayerGroup | null>(null);
  const streetViewMarkersRef = useRef<L.CircleMarker[]>([]);
  // One canvas renderer for all street-view points: thousands of SVG nodes
  // with three listeners each made panning crawl at low zooms.
  const streetViewRendererRef = useRef<L.Canvas | null>(null);
  // Aborts the previous streetview point load when a newer moveend fires.
  const streetViewAbortRef = useRef<AbortController | null>(null);

  // Measurement state
  const [measureMode, setMeasureMode] = useState<'none' | 'distance' | 'area'>('none');
  const measureLayerRef = useRef<L.FeatureGroup | null>(null);
  const measurePointsRef = useRef<L.LatLng[]>([]);
  const measureLineRef = useRef<L.Polyline | null>(null);
  const measurePolygonRef = useRef<L.Polygon | null>(null);
  const measureMarkersRef = useRef<L.CircleMarker[]>([]);

  // Avoid-area drawing state
  const [avoidDrawing, setAvoidDrawing] = useState(false);
  // Why the street-view layer shows nothing right now, or null when it does.
  const [streetViewHint, setStreetViewHint] = useState<string | null>(null);
  // What the armed tool has so far, for the banner's live line and its
  // "Fullfør" button: vertex count and the running result.
  const [toolStatus, setToolStatus] = useState<{ count: number; summary: string | null }>({
    count: 0,
    summary: null
  });
  // The armed tool's keyboard verbs, published by whichever drawing effect is
  // active so the container's keydown handler (registered once) can reach them.
  type ToolKeys = { addAtCenter: () => void; removeLast: () => void; finish: () => void };
  const measureKeysRef = useRef<ToolKeys | null>(null);
  const avoidKeysRef = useRef<ToolKeys | null>(null);
  // Whether the armed measurement was finished (as opposed to cancelled), so
  // leaving the mode keeps a result but discards a draft.
  const measureFinishedRef = useRef(false);
  // The last finished measurement, kept in the Verktøy readout until removed.
  const [lastMeasurement, setLastMeasurement] = useState<MeasurementResult | null>(null);
  const clearMeasurementRef = useRef<() => void>(() => {});
  // Rendered avoid-area polygons (synced from props.avoidAreas).
  const avoidLayerRef = useRef<L.FeatureGroup | null>(null);
  // In-progress drawing scratch state.
  const avoidDraftPointsRef = useRef<L.LatLng[]>([]);
  const avoidDraftPolygonRef = useRef<L.Polygon | null>(null);
  const avoidDraftMarkersRef = useRef<L.CircleMarker[]>([]);
  const avoidDraftLayerRef = useRef<L.FeatureGroup | null>(null);

  // Tile layers for different styles
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // Custom layers - load from localStorage on init
  const [showLayerManager, setShowLayerManager] = useState(false);
  // Persisted entries are validated before they can reach Leaflet: a broken
  // layer in storage would otherwise crash the app on every reload.
  const [customLayers, setCustomLayers] = useState<CustomLayerConfig[]>(() =>
    loadStoredLayers(typeof localStorage !== 'undefined' ? localStorage : undefined)
  );
  // Layer refs - keyed by "serviceId:layerId" for OGC services or just id for files/xyz
  const tileLayersRef = useRef<Map<string, L.TileLayer | L.TileLayer.WMS>>(new Map());
  const vectorLayersRef = useRef<Map<string, L.GeoJSON>>(new Map());
  // In-flight WFS/WCS loads, one per layer key, so the effect re-running
  // (any layer change) can't start a duplicate request or add a stale result.
  const pendingVectorLoadsRef = useRef(new PendingLoads());
  const expectedLayerKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = pendingVectorLoadsRef.current;
    return () => pending.cancelAll();
  }, []);

  // Persist custom layers, debounced (an opacity slider fires per tick) and
  // within a size budget: a multi-MB upload would exhaust the origin's storage
  // and silently stop every later write. Layers that are too large stay for
  // the session only, and the user is told once per layer.
  const warnedTooLargeRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { json, dropped } = serializeLayersForStorage(customLayers);
      dropped.forEach(({ id, name }) => {
        if (warnedTooLargeRef.current.has(id)) return;
        warnedTooLargeRef.current.add(id);
        toastRef.current.warning(
          `Kartlaget «${name}» er for stort til å huskes mellom økter og forsvinner når siden lastes på nytt.`
        );
      });
      try {
        localStorage.setItem(STORED_LAYERS_KEY, json);
      } catch (e) {
        console.error('Failed to save custom layers to localStorage:', e);
        toastRef.current.warning('Kunne ikke lagre kartlagene lokalt (lagringsplassen er full).');
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [customLayers]);

  const [currentStyleUrl, setCurrentStyleUrl] = useState(() => {
    const styles = props.mapStyles.length ? props.mapStyles : defaultMapStyles;
    const restored = props.initialStyleId
      ? styles.find((s: MapStyle) => s.id === props.initialStyleId)
      : undefined;
    return (restored ?? styles[0])?.url ?? '';
  });

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const styles = props.mapStyles.length ? props.mapStyles : defaultMapStyles;
    if (!styles.length) return;

    setCurrentStyleUrl((current: string) => {
      const exists = styles.some((style: MapStyle) => style.url === current);
      return exists ? current : styles[0].url;
    });
  }, [props.mapStyles]);

  // Initialize map
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: [propsRef.current.center.lat, propsRef.current.center.lng],
      zoom: propsRef.current.zoom,
      zoomControl: false
    });

    mapRef.current = map;
    // Credits stay, links go: the app does not send its users to third-party sites.
    map.attributionControl.setPrefix('Leaflet');

    // Add initial tile layer. Honor a style restored from the URL hash, else
    // fall back to the first configured style.
    const styles = propsRef.current.mapStyles.length ? propsRef.current.mapStyles : defaultMapStyles;
    const restoredStyle = propsRef.current.initialStyleId
      ? styles.find((s: MapStyle) => s.id === propsRef.current.initialStyleId)
      : undefined;
    const initialStyle = restoredStyle ?? styles[0];
    const initialLayer = L.tileLayer(initialStyle.url, {
      attribution: plainAttribution(initialStyle.attribution || OSM_CREDIT),
      maxZoom: 19
    }).addTo(map);
    watchBasemapTiles(initialLayer, () => propsRef.current.onBasemapError?.(initialStyle.name));
    tileLayerRef.current = initialLayer;

    // Initialize layer groups
    measureLayerRef.current = new L.FeatureGroup().addTo(map);
    avoidLayerRef.current = new L.FeatureGroup().addTo(map);
    avoidDraftLayerRef.current = new L.FeatureGroup().addTo(map);
    streetViewLayerRef.current = L.layerGroup().addTo(map);

    // Handle clicks
    // One lookup for every way of asking "what is here?": a click, Enter on
    // the focused map (at its centre) and "Hva er her?" in the map menu. It
    // always answers with the card: the address when the lookup succeeds,
    // otherwise the coordinates and a line saying why, so the point can still
    // be saved or routed to and the question never feels swallowed.
    const lookupAt = async (lat: number, lng: number) => {
      // Abort any in-flight lookup so only the latest question wins.
      reverseGeocodeAbortRef.current?.abort();
      const controller = new AbortController();
      reverseGeocodeAbortRef.current = controller;
      const pointFeature: GeoJSONFeature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { display_name: formatLatLng(lat, lng) }
      };
      // Mark the point at once, so the question visibly landed while the
      // lookup runs; the answer's own marker takes over when it arrives.
      pendingLookupRef.current?.remove();
      const pending = L.circleMarker([lat, lng], {
        radius: 9,
        color: mapColors.pointHalo,
        weight: 3,
        fillColor: mapColors.featurePoint,
        fillOpacity: 0.4,
        interactive: false,
        className: 'lookup-pending'
      }).addTo(map);
      pendingLookupRef.current = pending;
      // The answer takes keyboard focus only if focus is still free when it
      // lands: on the map, on nothing, or on the menu that asked. Someone who
      // has moved on to type elsewhere keeps their place.
      const focusIsFree = () => {
        const active = document.activeElement;
        return (
          !active ||
          active === document.body ||
          active === map.getContainer() ||
          Boolean(active.closest('[role="menu"]'))
        );
      };
      try {
        const geoFeature = await ReverseGeocode(lat, lng, controller.signal);
        if (controller.signal.aborted) return;
        const options = { focus: focusIsFree() };
        if (geoFeature) {
          propsRef.current.onSelect?.(geoFeature, undefined, options);
        } else {
          propsRef.current.onSelect?.(pointFeature, 'Fant ingen adresse for punktet.', options);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Reverse geocode failed', error);
        propsRef.current.onSelect?.(
          pointFeature,
          toUserMessage(error, 'Kunne ikke hente adressen for punktet. Får ikke kontakt med adressetjenesten.'),
          { focus: focusIsFree(), retry: true }
        );
      } finally {
        if (reverseGeocodeAbortRef.current === controller) {
          reverseGeocodeAbortRef.current = null;
        }
        if (pendingLookupRef.current === pending) {
          pending.remove();
          pendingLookupRef.current = null;
        }
      }
    };
    lookupAtRef.current = lookupAt;

    map.on('click', (e: LeafletMouseEvent) => {
      const currentMeasureMode = measureModeRef.current;

      // If in measurement mode, add point instead of reverse geocoding
      if (currentMeasureMode !== 'none') {
        return; // Measurement click is handled by separate effect
      }

      // If drawing an avoid-area, the avoid-area effect handles the click.
      if (avoidDrawingRef.current) {
        return;
      }

      void lookupAt(e.latlng.lat, e.latlng.lng);
    });

    // Handle right-click
    map.on('contextmenu', (e: LeafletMouseEvent) => {
      const handlerProps = propsRef.current;
      if (!handlerProps.onRightClick) return;

      handlerProps.onRightClick({
        lng: e.latlng.lng,
        lat: e.latlng.lat,
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY
      });
    });

    // The drawn panorama nearest a point, within the reach of a click.
    const PANORAMA_REACH_PX = 40;
    const nearestPanorama = (center: L.LatLng): StreetViewEventDetail | null => {
      const origin = map.latLngToContainerPoint(center);
      let best: StreetViewEventDetail | null = null;
      let bestDistance = PANORAMA_REACH_PX;
      for (const point of streetViewPointsRef.current) {
        const distance = origin.distanceTo(map.latLngToContainerPoint([point.lngLat.lat, point.lngLat.lng]));
        if (distance <= bestDistance) {
          best = point;
          bestDistance = distance;
        }
      }
      return best;
    };

    // Keyboard users get the same menu, at the map's centre: the ContextMenu
    // key or Shift+F10 while the map has focus.
    const onContainerKeyDown = (event: KeyboardEvent) => {
      // An armed tool listens for its verbs first: Space adds a vertex where
      // the crosshair stands (the map centre), Enter finishes, Backspace
      // removes the last vertex. Arrow keys still pan the map underneath.
      const keys = avoidKeysRef.current ?? measureKeysRef.current;
      if (keys) {
        if (event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          keys.addAtCenter();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          keys.finish();
          return;
        }
        if (event.key === 'Backspace') {
          event.preventDefault();
          keys.removeLast();
          return;
        }
      }
      // No tool armed: Enter asks "what is here?" at the crosshair (the map
      // centre). Only on the map itself, never on a popup or marker inside it.
      if (event.key === 'Enter' && event.target === container) {
        event.preventDefault();
        const center = map.getCenter();
        // With Gatebilde on, Enter opens the panorama nearest the crosshair;
        // elsewhere, or with none in reach, it asks what is here.
        const panorama = propsRef.current.streetViewVisible ? nearestPanorama(center) : null;
        if (panorama) {
          propsRef.current.onStreetViewSelect?.(panorama);
          return;
        }
        void lookupAt(center.lat, center.lng);
        return;
      }
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const handlerProps = propsRef.current;
      if (!handlerProps.onRightClick) return;
      event.preventDefault();
      const center = map.getCenter();
      const point = map.latLngToContainerPoint(center);
      const rect = container.getBoundingClientRect();
      handlerProps.onRightClick({
        lng: center.lng,
        lat: center.lat,
        x: rect.left + point.x,
        y: rect.top + point.y
      });
    };
    container.addEventListener('keydown', onContainerKeyDown);

    // Leaflet names its popup close button in English ("Close popup").
    const onPopupOpen = (event: L.PopupEvent) => {
      const close = event.popup.getElement()?.querySelector('.leaflet-popup-close-button');
      close?.setAttribute('aria-label', 'Lukk');
      close?.setAttribute('title', 'Lukk');
    };
    map.on('popupopen', onPopupOpen);

    // Report view changes (pan/zoom) so the parent can sync the URL hash.
    const emitViewChange = () => {
      movingRef.current = false;
      const { onViewChange, onOverpassVisibilityChange, onRouteVisibilityChange } = propsRef.current;
      onOverpassVisibilityChange?.(countHiddenHits(overpassNumberRef.current, map.getBounds()));
      onRouteVisibilityChange?.(routeVisibility(routeLayerRef.current, map.getBounds()));
      if (!onViewChange) return;
      const center = map.getCenter();
      onViewChange({ zoom: map.getZoom(), lat: center.lat, lng: center.lng });
    };
    const onMoveStart = () => {
      movingRef.current = true;
    };
    map.on('movestart', onMoveStart);
    map.on('moveend', emitViewChange);
    map.on('zoomend', emitViewChange);
    // Emit the initial view once so a fresh load reflects the starting state.
    emitViewChange();

    setMapLoaded(true);

    return () => {
      container.removeEventListener('keydown', onContainerKeyDown);
      map.off('popupopen', onPopupOpen);
      map.off('movestart', onMoveStart);
      map.off('moveend', emitViewChange);
      map.off('zoomend', emitViewChange);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Handle measurement mode changes: clicks, double-clicks and the keyboard
  // verbs share one set of handlers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !measureLayerRef.current) return;

    // Clear previous measurement visualization
    const clearMeasurement = () => {
      if (measureLineRef.current) {
        measureLayerRef.current?.removeLayer(measureLineRef.current);
        measureLineRef.current = null;
      }
      if (measurePolygonRef.current) {
        measureLayerRef.current?.removeLayer(measurePolygonRef.current);
        measurePolygonRef.current = null;
      }
      measureMarkersRef.current.forEach((m: L.CircleMarker) => measureLayerRef.current?.removeLayer(m));
      measureMarkersRef.current = [];
      measurePointsRef.current = [];
    };

    // "Fjern målingen" in the readout reaches the same clean-up.
    clearMeasurementRef.current = () => {
      clearMeasurement();
      setLastMeasurement(null);
    };

    if (measureMode === 'none') {
      // Leaving measure mode keeps the finished line or polygon on the map,
      // with its result in the readout; it is cleared when the next one
      // starts or when the readout's "Fjern målingen" is pressed.
      map.getContainer().style.cursor = '';
      map.doubleClickZoom.enable();
      return;
    }

    // A new measurement replaces the previous one only once it is finished.
    // Until then the old line stays on the map, faded, with its readout, and
    // cancelling brings it back as it was: arming a tool never loses a result.
    const previous =
      measurePointsRef.current.length > 0
        ? {
            line: measureLineRef.current,
            polygon: measurePolygonRef.current,
            markers: measureMarkersRef.current,
            points: measurePointsRef.current
          }
        : null;
    const previousLayers: L.Path[] = [];
    if (previous) {
      if (previous.line) previousLayers.push(previous.line);
      if (previous.polygon) previousLayers.push(previous.polygon);
      previousLayers.push(...previous.markers);
    }
    const previousStyles = previousLayers.map((layer) => ({
      opacity: layer.options.opacity,
      fillOpacity: layer.options.fillOpacity
    }));
    previousLayers.forEach((layer) => layer.setStyle({ opacity: 0.35, fillOpacity: 0.08 }));
    measureLineRef.current = null;
    measurePolygonRef.current = null;
    measureMarkersRef.current = [];
    measurePointsRef.current = [];
    let previousGone = previous === null;
    const discardPrevious = () => {
      previousLayers.forEach((layer) => measureLayerRef.current?.removeLayer(layer));
      previousGone = true;
    };
    const restorePrevious = () => {
      if (!previous || previousGone) return;
      previousLayers.forEach((layer, index) => layer.setStyle(previousStyles[index]));
      measureLineRef.current = previous.line;
      measurePolygonRef.current = previous.polygon;
      measureMarkersRef.current = previous.markers;
      measurePointsRef.current = previous.points;
    };
    // While drawing, the readout still belongs to the previous result, so
    // "Fjern målingen" removes that one and leaves the draft alone.
    clearMeasurementRef.current = () => {
      discardPrevious();
      setLastMeasurement(null);
    };
    measureFinishedRef.current = false;
    setToolStatus({ count: 0, summary: null });

    // Disable double-click zoom while measuring
    map.doubleClickZoom.disable();

    map.getContainer().style.cursor = 'crosshair';

    const minPoints = measureMode === 'distance' ? 2 : 3;

    const currentSummary = (): string | null => {
      const points = measurePointsRef.current;
      if (measureMode === 'distance' && points.length >= 2) {
        return `Avstand: ${formatDistance(calculateGeodesicDistance(points))}`;
      }
      if (measureMode === 'area' && points.length >= 3) {
        return `Areal: ${formatArea(calculateSphericalArea(points))}`;
      }
      return null;
    };

    // Tooltip for showing live measurement
    let measureTooltip: L.Tooltip | null = null;
    const updateMeasurementTooltip = () => {
      const points = measurePointsRef.current;
      if (points.length < 2) {
        if (measureTooltip) {
          map.closeTooltip(measureTooltip);
          measureTooltip = null;
        }
        return;
      }

      // Only the running value: the banner already says how to add and finish.
      const summary = currentSummary();
      if (!summary) {
        if (measureTooltip) {
          map.closeTooltip(measureTooltip);
          measureTooltip = null;
        }
        return;
      }
      const lastPoint = points[points.length - 1];
      const content = summary;

      if (measureTooltip) {
        measureTooltip.setLatLng(lastPoint).setContent(content);
      } else {
        measureTooltip = L.tooltip({
          permanent: true,
          direction: 'top',
          className: 'measurement-tooltip'
        })
          .setLatLng(lastPoint)
          .setContent(content)
          .addTo(map);
      }
    };

    // Redraw the line or polygon from the current points.
    const renderShape = () => {
      const points = measurePointsRef.current;
      if (measureMode === 'distance') {
        if (measureLineRef.current) {
          measureLayerRef.current?.removeLayer(measureLineRef.current);
          measureLineRef.current = null;
        }
        if (points.length >= 2) {
          measureLineRef.current = L.polyline(points, {
            color: mapColors.measureStroke,
            weight: 3,
            opacity: 0.8,
            interactive: false
          }).addTo(measureLayerRef.current!);
        }
      } else {
        if (measurePolygonRef.current) {
          measureLayerRef.current?.removeLayer(measurePolygonRef.current);
          measurePolygonRef.current = null;
        }
        // The first two points of an area are joined by a line, so the second
        // click visibly connects before the third closes the shape.
        if (measureLineRef.current) {
          measureLayerRef.current?.removeLayer(measureLineRef.current);
          measureLineRef.current = null;
        }
        if (points.length === 2) {
          measureLineRef.current = L.polyline(points, {
            color: mapColors.measureStroke,
            weight: 3,
            opacity: 0.8,
            interactive: false
          }).addTo(measureLayerRef.current!);
        }
        if (points.length >= 3) {
          measurePolygonRef.current = L.polygon(points, {
            color: mapColors.measureStroke,
            weight: 3,
            fillColor: mapColors.measureFill,
            fillOpacity: 0.2,
            interactive: false
          }).addTo(measureLayerRef.current!);
        }
      }
      updateMeasurementTooltip();
      setToolStatus({ count: points.length, summary: currentSummary() });
    };

    const addPoint = (latlng: L.LatLng) => {
      measurePointsRef.current.push(latlng);

      // Add marker for the point
      const marker = L.circleMarker(latlng, {
        radius: 6,
        fillColor: mapColors.measureVertexFill,
        color: mapColors.measureVertexStroke,
        weight: 2,
        fillOpacity: 1,
        // Non-interactive so clicks/double-clicks land on the map handlers
        // (otherwise the vertex/line/polygon swallow them and the user can't
        // add points or double-click to finish — mirrors the avoid-area fix).
        interactive: false
      });
      marker.addTo(measureLayerRef.current!);
      measureMarkersRef.current.push(marker);
      renderShape();
    };

    const removeLastPoint = () => {
      if (measurePointsRef.current.length === 0) return;
      measurePointsRef.current.pop();
      const marker = measureMarkersRef.current.pop();
      if (marker) measureLayerRef.current?.removeLayer(marker);
      renderShape();
    };

    // Turn the points into a result. Returns false when there are too few.
    const finish = (): boolean => {
      const points = measurePointsRef.current;
      if (points.length < minPoints) return false;

      if (measureTooltip) {
        map.closeTooltip(measureTooltip);
        measureTooltip = null;
      }

      let result: MeasurementResult;
      if (measureMode === 'distance') {
        const distance = calculateGeodesicDistance(points);
        result = {
          type: 'distance',
          value: distance,
          unit: distance >= 1000 ? 'km' : 'm',
          coordinates: points.map((ll: L.LatLng) => [ll.lng, ll.lat] as [number, number])
        };
      } else {
        const area = calculateSphericalArea(points);
        result = {
          type: 'area',
          value: area,
          unit: area >= 1000000 ? 'km²' : 'm²',
          coordinates: points.map((ll: L.LatLng) => [ll.lng, ll.lat] as [number, number])
        };
      }

      // The readout is the one place the result is shown; the map keeps only
      // the line or polygon, so the value never appears twice.
      discardPrevious();
      setLastMeasurement(result);
      // The readout opens bottom right, above the tools. When it would cover the
      // end of the line just drawn, pan left only as far as needed to show it.
      const end = points[points.length - 1];
      window.setTimeout(() => {
        const stack = document.querySelector('.map-tools-stack')?.getBoundingClientRect();
        if (!stack || !end || !mapRef.current) return;
        const box = map.getContainer().getBoundingClientRect();
        const at = map.latLngToContainerPoint(end);
        const margin = 24;
        const overlap = box.left + at.x - (stack.left - margin);
        if (overlap > 0 && box.top + at.y > stack.top - margin) map.panBy([overlap, 0]);
      }, 60);
      propsRef.current.onMeasurementComplete?.(result);

      // Reset mode but keep the measurement visible
      measureFinishedRef.current = true;
      setMeasureMode('none');
      map.getContainer().style.cursor = '';
      return true;
    };

    const handleMeasureClick = (e: LeafletMouseEvent) => addPoint(e.latlng);

    const handleMeasureDoubleClick = (e: LeafletMouseEvent) => {
      L.DomEvent.stop(e);

      // The double-click's own second click added a duplicate of the last
      // vertex (and its marker); drop both before computing the result.
      const finalized = finalizeMeasurementPoints(measurePointsRef.current);
      if (finalized.length < measurePointsRef.current.length) {
        const extra = measureMarkersRef.current.pop();
        if (extra) measureLayerRef.current?.removeLayer(extra);
        measurePointsRef.current = finalized;
        measureLineRef.current?.setLatLngs(finalized);
        measurePolygonRef.current?.setLatLngs(finalized);
      }

      // A double-click with too few points ends the attempt.
      if (!finish()) {
        clearMeasurement();
        setMeasureMode('none');
      }
    };

    map.on('click', handleMeasureClick);
    map.on('dblclick', handleMeasureDoubleClick);
    measureKeysRef.current = {
      addAtCenter: () => addPoint(map.getCenter()),
      removeLast: removeLastPoint,
      // Enter with too few points does nothing; the banner says how many.
      finish: () => {
        finish();
      }
    };

    return () => {
      map.off('click', handleMeasureClick);
      map.off('dblclick', handleMeasureDoubleClick);
      measureKeysRef.current = null;
      map.getContainer().style.cursor = '';
      if (measureTooltip) {
        map.closeTooltip(measureTooltip);
      }
      // Cancelling (Escape, Avbryt, arming another tool) discards the draft;
      // only a finished measurement stays on the map.
      if (!measureFinishedRef.current) {
        clearMeasurement();
        restorePrevious();
      }
      setToolStatus({ count: 0, summary: null });
    };
  }, [measureMode]);

  // Avoid-area drawing: click (or Space) to add vertices, double-click (or
  // Enter) to finish a polygon, Backspace to remove the last vertex.
  useEffect(() => {
    const map = mapRef.current;
    const draftLayer = avoidDraftLayerRef.current;
    if (!map || !mapLoaded || !draftLayer) return;

    const clearDraft = () => {
      if (avoidDraftPolygonRef.current) {
        draftLayer.removeLayer(avoidDraftPolygonRef.current);
        avoidDraftPolygonRef.current = null;
      }
      avoidDraftMarkersRef.current.forEach((m: L.CircleMarker) => draftLayer.removeLayer(m));
      avoidDraftMarkersRef.current = [];
      avoidDraftPointsRef.current = [];
    };

    clearDraft();

    if (!avoidDrawing) {
      map.getContainer().style.cursor = '';
      map.doubleClickZoom.enable();
      return;
    }

    map.doubleClickZoom.disable();
    map.getContainer().style.cursor = 'crosshair';
    setToolStatus({ count: 0, summary: null });

    const renderDraft = () => {
      const points = avoidDraftPointsRef.current;
      if (avoidDraftPolygonRef.current) {
        draftLayer.removeLayer(avoidDraftPolygonRef.current);
        avoidDraftPolygonRef.current = null;
      }
      if (points.length >= 2) {
        avoidDraftPolygonRef.current = L.polygon(points, {
          color: mapColors.avoidStroke,
          weight: 2,
          fillColor: mapColors.avoidFill,
          fillOpacity: 0.25,
          dashArray: '6, 6',
          // Non-interactive so clicks/double-clicks inside the draft polygon
          // still reach the map handlers (otherwise the shape swallows them and
          // you can never add points or finish from inside the area).
          interactive: false
        }).addTo(draftLayer);
      }
      setToolStatus({ count: points.length, summary: null });
    };

    const addPoint = (latlng: L.LatLng) => {
      avoidDraftPointsRef.current.push(latlng);
      const marker = L.circleMarker(latlng, {
        radius: 5,
        fillColor: mapColors.avoidFill,
        color: mapColors.avoidVertexStroke,
        weight: 2,
        fillOpacity: 1,
        interactive: false
      }).addTo(draftLayer);
      avoidDraftMarkersRef.current.push(marker);
      renderDraft();
    };

    const removeLastPoint = () => {
      if (avoidDraftPointsRef.current.length === 0) return;
      avoidDraftPointsRef.current.pop();
      const marker = avoidDraftMarkersRef.current.pop();
      if (marker) draftLayer.removeLayer(marker);
      renderDraft();
    };

    // Commit the polygon as a ring of [lng, lat] and append to existing
    // areas. Returns false when there are too few points for a ring.
    const finish = (): boolean => {
      const points = avoidDraftPointsRef.current;
      if (points.length < 3) return false;
      const ring = points.map((ll: L.LatLng) => [ll.lng, ll.lat] as [number, number]);
      const existing = propsRef.current.avoidAreas ?? [];
      clearDraft();
      propsRef.current.onAvoidAreasChange?.([...existing, ring]);
      // Exit drawing mode once a polygon is committed (hides the instruction
      // banner). Re-press the avoid row to add another area.
      setAvoidDrawing(false);
      return true;
    };

    const handleClick = (e: LeafletMouseEvent) => addPoint(e.latlng);

    const handleDoubleClick = (e: LeafletMouseEvent) => {
      L.DomEvent.stop(e);
      if (!finish()) clearDraft();
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDoubleClick);
    avoidKeysRef.current = {
      addAtCenter: () => addPoint(map.getCenter()),
      removeLast: removeLastPoint,
      finish: () => {
        finish();
      }
    };

    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDoubleClick);
      avoidKeysRef.current = null;
      map.getContainer().style.cursor = '';
      clearDraft();
      setToolStatus({ count: 0, summary: null });
    };
  }, [mapLoaded, avoidDrawing]);

  // Sync committed avoid-area polygons (props) into the avoid layer.
  useEffect(() => {
    const map = mapRef.current;
    const layer = avoidLayerRef.current;
    if (!map || !mapLoaded || !layer) return;

    layer.clearLayers();
    props.avoidAreas.forEach((ring) => {
      if (ring.length < 3) return;
      // ring is [lng, lat]; Leaflet wants [lat, lng].
      const latlngs = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polygon(latlngs, {
        color: mapColors.avoidStroke,
        weight: 2,
        fillColor: mapColors.avoidFill,
        fillOpacity: 0.3,
        // Committed avoid areas must not capture map clicks/right-clicks.
        interactive: false
      }).addTo(layer);
    });
  }, [mapLoaded, props.avoidAreas]);

  // Mirror tool state for the map click handler.
  useEffect(() => {
    measureModeRef.current = measureMode;
  }, [measureMode]);
  useEffect(() => {
    avoidDrawingRef.current = avoidDrawing;
  }, [avoidDrawing]);

  // Avoid areas only matter to a route: leaving route planning disarms the tool.
  useEffect(() => {
    if (!props.navigationMode) setAvoidDrawing(false);
  }, [props.navigationMode]);

  // Sync hovered feature layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (hoveredLayerRef.current) {
      map.removeLayer(hoveredLayerRef.current);
      hoveredLayerRef.current = null;
    }

    if (props.hoveredFeature) {
      hoveredLayerRef.current = L.geoJSON(toFeatureCollection(props.hoveredFeature) as GeoJsonObject, {
        style: {
          color: mapColors.hoverStroke,
          weight: 4,
          fillColor: mapColors.hoverFill,
          fillOpacity: 0.4
        },
        pointToLayer: (_feature, latlng) => {
          return L.circleMarker(latlng, {
            radius: 9,
            fillColor: mapColors.hoverPoint,
            color: mapColors.pointHalo,
            weight: 3,
            fillOpacity: 0.9
          });
        }
      }).addTo(map);
    }
  }, [mapLoaded, props.hoveredFeature]);

  // Sync selected feature layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (selectedLayerRef.current) {
      map.removeLayer(selectedLayerRef.current);
      selectedLayerRef.current = null;
    }

    // An area-search hit is already on the map as its numbered dot, drawn
    // selected; a second marker on top would hide the number.
    if (props.selectedFeature && typeof props.selectedFeature.properties?.__overpassIndex !== 'number') {
      selectedLayerRef.current = L.geoJSON(toFeatureCollection(props.selectedFeature) as GeoJsonObject, {
        style: {
          color: mapColors.selectedStroke,
          weight: 4,
          fillColor: mapColors.selectedFill,
          fillOpacity: 0.4
        },
        pointToLayer: (_feature, latlng) => {
          // A filled dot with a white halo: findable on any tile.
          return L.circleMarker(latlng, {
            radius: 9,
            fillColor: mapColors.selectedPoint,
            color: mapColors.pointHalo,
            weight: 3,
            fillOpacity: 1
          });
        }
      }).addTo(map);
    }
  }, [mapLoaded, props.selectedFeature]);

  // Sync route layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (props.routeFeature) {
      routeLayerRef.current = L.geoJSON(props.routeFeature as GeoJsonObject, {
        style: (feature) => routeStyle(feature, routeDimmedRef.current),
        onEachFeature: (feature, layer) => {
          const props2 = feature?.properties ?? {};
          if (props2.style === 'solid') {
            // Paths bubble mouse events to the map; a click on the active
            // route must not reverse-geocode (and re-center) like a map click.
            layer.on('click', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e));
            return;
          }
          if (props2.style !== 'alternative') return;
          // Clicking an alternative makes it the active route.
          const routeIndex =
            typeof props2.route_index === 'number' ? props2.route_index : undefined;
          if (routeIndex === undefined) return;
          layer.on('click', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e);
            propsRef.current.onSelectAlternative?.(routeIndex);
          });
          if ('bringToBack' in layer && typeof layer.bringToBack === 'function') {
            layer.bringToBack();
          }
        }
      }).addTo(map);
    }
  }, [mapLoaded, props.routeFeature]);

  // The route changed: say how much of it the view shows. Pans and zooms
  // report through emitViewChange; a route that arrives already in view, or
  // goes, is reported here. A route being revealed is moving the map, and its
  // moveend reports the view it lands on (see movingRef).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || movingRef.current) return;
    propsRef.current.onRouteVisibilityChange?.(routeVisibility(routeLayerRef.current, map.getBounds()));
  }, [mapLoaded, props.routeFeature]);

  // What the route details point at, drawn over the route: a category's
  // stretches in the selection colour over a white casing, and the profile's
  // dot. Never interactive (a highlight must not eat a map click) and never
  // moving the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    routeHighlightRef.current?.remove();
    routeHighlightRef.current = null;

    const geometry = props.routeHighlight ?? null;
    const dimmed = Boolean(geometry && geometry.stretches.length > 0);
    routeDimmedRef.current = dimmed;
    routeLayerRef.current?.setStyle((feature) => routeStyle(feature, dimmed));
    if (!geometry) return;

    const group = L.layerGroup();
    for (const run of geometry.stretches) {
      const latlngs = run.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(latlngs, {
        color: mapColors.pointHalo,
        weight: 10,
        opacity: 1,
        interactive: false,
        className: 'route-highlight-casing'
      }).addTo(group);
      L.polyline(latlngs, {
        color: mapColors.routeHighlight,
        weight: 6,
        opacity: 1,
        interactive: false,
        className: 'route-highlight-stretch'
      }).addTo(group);
    }
    if (geometry.point) {
      L.circleMarker([geometry.point[1], geometry.point[0]], {
        radius: 6,
        color: mapColors.pointHalo,
        weight: 3,
        fillColor: mapColors.routeHighlight,
        fillOpacity: 1,
        interactive: false,
        className: 'route-highlight-point'
      }).addTo(group);
    }
    group.addTo(map);
    routeHighlightRef.current = group;
  }, [mapLoaded, props.routeHighlight]);

  // Sync overpass features layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (overpassLayerRef.current) {
      map.removeLayer(overpassLayerRef.current);
      overpassLayerRef.current = null;
    }

    overpassSubLayersRef.current.clear();
    overpassNumberRef.current.clear();

    if (props.overpassFeatures.length > 0) {
      // Tag each feature with its source index so we can map the rendered
      // sub-layer back to the row in the results sidebar.
      const features = props.overpassFeatures.map((feature, index) => ({
        ...feature,
        properties: { ...(feature.properties ?? {}), __overpassIndex: index }
      })) as Feature<Geometry>[];
      const collection: FeatureCollection<Geometry> = {
        type: 'FeatureCollection',
        features
      };

      // Each hit carries the number of its row in the results list, so the
      // list and the map can be read together. The colours come from the map
      // palette; the number is an integer, never user text.
      const numberIcon = (index: number) =>
        L.divIcon({
          // Three digits need a pill, not a smaller number.
          className: index + 1 >= 100 ? 'overpass-hit is-wide' : 'overpass-hit',
          html: `<span style="background-color:${mapColors.featurePoint};border-color:${mapColors.pointHalo};color:${mapColors.pointHalo};--hit-ring:${mapColors.selectedStroke}">${index + 1}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          tooltipAnchor: [0, -14]
        });
      const areaLabels: L.Marker[] = [];

      overpassLayerRef.current = L.geoJSON(collection as GeoJsonObject, {
        style: {
          color: mapColors.featureStroke,
          weight: 2,
          fillColor: mapColors.featureFill,
          fillOpacity: 0.4
        },
        pointToLayer: (feature, latlng) => {
          const index = feature.properties?.__overpassIndex;
          const marker = L.marker(latlng, {
            // The results list is the keyboard path; dozens of dots in the
            // tab order would only be in the way.
            keyboard: false,
            icon: numberIcon(typeof index === 'number' ? index : 0)
          });
          if (typeof index === 'number') overpassNumberRef.current.set(index, marker);
          return marker;
        },
        onEachFeature: (feature, layer) => {
          const index = feature.properties?.__overpassIndex;
          if (typeof index !== 'number') return;
          overpassSubLayersRef.current.set(index, layer);
          // A hit answers like a searched place: a click on its dot or its
          // area opens the details card in the rail, never a popup. The click
          // stops here, or the map would also look up the address underneath.
          const select = (event: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(event);
            propsRef.current.onOverpassSelect?.(index);
          };
          layer.on('click', select);
          // The hit's name as a small label on hover: text, never HTML, because
          // OSM names are user data.
          const nameLabel = () => {
            const text = document.createElement('span');
            text.textContent = getDisplayName(feature as GeoJSONFeature);
            return text;
          };
          if (layer instanceof L.Marker) {
            layer.bindTooltip(nameLabel(), { direction: 'top', className: 'overpass-tooltip' });
          } else if ('getBounds' in layer) {
            // Areas and lines get their number, and the name label, at their centre.
            const bounds = (layer as L.Polyline).getBounds();
            if (bounds.isValid()) {
              const label = L.marker(bounds.getCenter(), { keyboard: false, icon: numberIcon(index) });
              label.bindTooltip(nameLabel(), { direction: 'top', className: 'overpass-tooltip' });
              label.on('click', select);
              areaLabels.push(label);
              overpassNumberRef.current.set(index, label);
            }
          }
        }
      }).addTo(map);
      areaLabels.forEach((label) => overpassLayerRef.current?.addLayer(label));
    }
  }, [mapLoaded, props.overpassFeatures]);

  // The hit whose card is open: its dot grows, takes the selected ring and
  // stays above its neighbours.
  useEffect(() => {
    overpassNumberRef.current.forEach((marker, i) => {
      const selected = i === props.selectedOverpassIndex;
      marker.getElement()?.classList.toggle('is-selected', selected);
      marker.setZIndexOffset(selected ? 2000 : 0);
    });
  }, [mapLoaded, props.overpassFeatures, props.selectedOverpassIndex]);

  // The answer changed: say how many of its hits the current view shows. Pans
  // and zooms report through emitViewChange; this covers the answer arriving,
  // coming back with Angre, or being replaced while the map stands still.
  // Declared after the layer effect above, so the numbered markers exist.
  useEffect(() => {
    const map = mapRef.current;
    // A fit under way (see movingRef) reports the view it lands on at moveend.
    if (!map || !mapLoaded || movingRef.current) return;
    propsRef.current.onOverpassVisibilityChange?.(
      countHiddenHits(overpassNumberRef.current, map.getBounds())
    );
  }, [mapLoaded, props.overpassFeatures]);

  // The extent the question asked about, as a hairline while its answer
  // stands. Unfilled and dashed, so it reads as the edge of a question and not
  // as a measured area (solid, 3px, filled); one pixel in the hits' own colour,
  // so the box and the dots read as one answer. Right after a search the view
  // fits the hits, which lie inside it, so the box is mostly off screen: it
  // comes into view exactly when the user has moved away from what they asked
  // about. Never interactive — a query's edge must not eat a map click — and
  // held behind everything else on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (areaExtentRef.current) {
      map.removeLayer(areaExtentRef.current);
      areaExtentRef.current = null;
    }
    const extent = props.areaExtent;
    if (!extent) return;
    const [west, south, east, north] = extent;
    areaExtentRef.current = L.rectangle(
      [
        [south, west],
        [north, east]
      ],
      {
        color: mapColors.areaExtentStroke,
        weight: 1,
        opacity: 0.7,
        dashArray: '6, 6',
        fill: false,
        interactive: false,
        className: 'area-extent'
      }
    ).addTo(map);
    areaExtentRef.current.bringToBack();
  }, [mapLoaded, props.areaExtent]);

  // Sync custom layers (OGC services, files, XYZ tiles)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Build a set of all expected layer keys
    const expectedLayerKeys = new Set<string>();
    
    customLayers.forEach(config => {
      if (config.type === 'ogc-service') {
        const ogcConfig = config as OGCServiceConfig;
        ogcConfig.layers.filter(l => l.enabled).forEach(layer => {
          expectedLayerKeys.add(`${ogcConfig.id}:${layer.name}`);
        });
      } else if (config.type === 'file') {
        if (config.visible) {
          expectedLayerKeys.add(config.id);
        }
      } else if (config.type === 'xyz') {
        if (config.visible) {
          expectedLayerKeys.add(config.id);
        }
      }
    });

    expectedLayerKeysRef.current = expectedLayerKeys;
    // Loads for layers that were disabled/removed meanwhile are cancelled.
    pendingVectorLoadsRef.current.cancelExcept(expectedLayerKeys);

    // Remove layers that are no longer expected
    tileLayersRef.current.forEach((layer: L.TileLayer | L.TileLayer.WMS, key: string) => {
      if (!expectedLayerKeys.has(key)) {
        map.removeLayer(layer);
        tileLayersRef.current.delete(key);
      }
    });

    vectorLayersRef.current.forEach((layer: L.GeoJSON, key: string) => {
      if (!expectedLayerKeys.has(key)) {
        map.removeLayer(layer);
        vectorLayersRef.current.delete(key);
      }
    });

    // Add or update layers
    customLayers.forEach(config => {
      if (config.type === 'ogc-service') {
        const ogcConfig = config as OGCServiceConfig;
        
        ogcConfig.layers.forEach(serviceLayer => {
          const layerKey = `${ogcConfig.id}:${serviceLayer.name}`;
          
          if (ogcConfig.serviceType === 'wms') {
            if (serviceLayer.enabled) {
              let wmsLayer = tileLayersRef.current.get(layerKey) as L.TileLayer.WMS | undefined;
              
              if (!wmsLayer) {
                wmsLayer = L.tileLayer.wms(ogcConfig.url, {
                  layers: serviceLayer.name,
                  format: 'image/png',
                  transparent: true,
                  version: '1.1.1',
                  attribution: ogcConfig.name
                });
                tileLayersRef.current.set(layerKey, wmsLayer);
              }
              
              if (!map.hasLayer(wmsLayer)) {
                wmsLayer.addTo(map);
              }
              wmsLayer.setOpacity(effectiveLayerOpacity(ogcConfig.opacity, serviceLayer.opacity));
              wmsLayer.setZIndex(ogcConfig.zIndex);
            } else {
              const existing = tileLayersRef.current.get(layerKey);
              if (existing && map.hasLayer(existing)) {
                map.removeLayer(existing);
              }
            }
          } else if (ogcConfig.serviceType === 'wmts') {
            if (serviceLayer.enabled) {
              let wmtsLayer = tileLayersRef.current.get(layerKey);
              
              if (!wmtsLayer) {
                // WMTS uses different URL structure
                const wmtsUrl = `${ogcConfig.url}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${serviceLayer.name}&STYLE=default&FORMAT=image/png&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
                wmtsLayer = L.tileLayer(wmtsUrl, {
                  attribution: ogcConfig.name
                });
                tileLayersRef.current.set(layerKey, wmtsLayer);
              }
              
              if (!map.hasLayer(wmtsLayer)) {
                wmtsLayer.addTo(map);
              }
              wmtsLayer.setOpacity(effectiveLayerOpacity(ogcConfig.opacity, serviceLayer.opacity));
              wmtsLayer.setZIndex(ogcConfig.zIndex);
            } else {
              const existing = tileLayersRef.current.get(layerKey);
              if (existing && map.hasLayer(existing)) {
                map.removeLayer(existing);
              }
            }
          } else if (ogcConfig.serviceType === 'wfs' || ogcConfig.serviceType === 'wcs') {
            if (serviceLayer.enabled) {
              const vectorLayer = vectorLayersRef.current.get(layerKey);
              const layerOpacity = effectiveLayerOpacity(ogcConfig.opacity, serviceLayer.opacity);

              if (!vectorLayer && !pendingVectorLoadsRef.current.has(layerKey)) {
                // Fetch WFS/WCS data (once; the registry holds the in-flight load)
                const controller = pendingVectorLoadsRef.current.start(layerKey);
                const fetchVectorData = async () => {
                  try {
                    const params = new URLSearchParams({
                      service: ogcConfig.serviceType.toUpperCase(),
                      version: '2.0.0',
                      request: 'GetFeature',
                      typeName: serviceLayer.name,
                      outputFormat: 'application/json',
                      maxFeatures: '1000',
                      srsName: 'EPSG:4326'
                    });

                    const response = await fetchWithTimeout(`${ogcConfig.url}?${params.toString()}`, {
                      signal: controller.signal
                    });
                    if (!response.ok) {
                      console.error(`${ogcConfig.serviceType.toUpperCase()} request failed: ${response.status}`);
                      toastRef.current.error(`Kunne ikke laste kartlaget «${serviceLayer.title || serviceLayer.name}»`);
                      return;
                    }

                    const geojson = await response.json();
                    // Superseded, or the layer was disabled/removed meanwhile.
                    if (!pendingVectorLoadsRef.current.isCurrent(layerKey, controller)) return;
                    if (!expectedLayerKeysRef.current.has(layerKey)) return;
                    
                    const newVectorLayer = L.geoJSON(geojson, {
                      style: {
                        color: mapColors.featureFill,
                        weight: 2,
                        fillColor: mapColors.featureFill,
                        fillOpacity: serviceLayer.opacity * 0.3
                      },
                      pointToLayer: (_, latlng) => {
                        return L.circleMarker(latlng, {
                          radius: 6,
                          fillColor: mapColors.featureFill,
                          color: mapColors.featureFill,
                          weight: 2,
                          fillOpacity: serviceLayer.opacity * 0.5
                        });
                      },
                      onEachFeature: (feature, layer) => {
                        if (feature.properties) {
                          const props = Object.entries(feature.properties)
                            .filter(([_, v]) => v !== null && v !== undefined)
                            .slice(0, 10)
                            .map(([k, v]) => `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}`)
                            .join('<br>');
                          if (props) {
                            layer.bindPopup(props);
                          }
                        }
                      }
                    });

                    vectorLayersRef.current.set(layerKey, newVectorLayer);
                    newVectorLayer.addTo(map);
                    applyVectorLayerOpacity(newVectorLayer, layerOpacity);
                  } catch (error) {
                    if (controller.signal.aborted) return;
                    console.error(`Failed to fetch ${ogcConfig.serviceType.toUpperCase()} layer:`, error);
                    toastRef.current.error(`Kunne ikke laste kartlaget «${serviceLayer.title || serviceLayer.name}»`);
                  } finally {
                    pendingVectorLoadsRef.current.finish(layerKey, controller);
                  }
                };

                void fetchVectorData();
              } else if (vectorLayer) {
                if (!map.hasLayer(vectorLayer)) {
                  vectorLayer.addTo(map);
                }
                // The slider used to be dead for vector layers: opacity was
                // baked into the style at creation only.
                applyVectorLayerOpacity(vectorLayer, layerOpacity);
              }
            } else {
              pendingVectorLoadsRef.current.cancel(layerKey);
              const existing = vectorLayersRef.current.get(layerKey);
              if (existing && map.hasLayer(existing)) {
                map.removeLayer(existing);
              }
            }
          } else if (ogcConfig.serviceType === 'tms' || ogcConfig.serviceType === 'xyz') {
            if (serviceLayer.enabled) {
              let tileLayer = tileLayersRef.current.get(layerKey);
              
              if (!tileLayer) {
                // TMS/XYZ URL pattern
                tileLayer = L.tileLayer(ogcConfig.url, {
                  attribution: ogcConfig.name,
                  tms: ogcConfig.serviceType === 'tms'
                });
                tileLayersRef.current.set(layerKey, tileLayer);
              }
              
              if (!map.hasLayer(tileLayer)) {
                tileLayer.addTo(map);
              }
              tileLayer.setOpacity(effectiveLayerOpacity(ogcConfig.opacity, serviceLayer.opacity));
              tileLayer.setZIndex(ogcConfig.zIndex);
            } else {
              const existing = tileLayersRef.current.get(layerKey);
              if (existing && map.hasLayer(existing)) {
                map.removeLayer(existing);
              }
            }
          }
        });
      } else if (config.type === 'file') {
        const fileConfig = config as FileLayerConfig;
        
        if (fileConfig.visible && fileConfig.data) {
          let vectorLayer = vectorLayersRef.current.get(fileConfig.id);
          
          if (!vectorLayer) {
            const built = buildFileVectorLayer(fileConfig);
            if (!built) {
              // Undrawable data: drop the layer instead of letting Leaflet
              // throw inside this effect (which would unmount the app).
              toastRef.current.error(`Kunne ikke tegne fillaget «${fileConfig.name}»`);
              setCustomLayers((prev) => prev.filter((l) => l.id !== fileConfig.id));
              return;
            }
            vectorLayer = built;
            vectorLayersRef.current.set(fileConfig.id, vectorLayer);
          }

          if (!map.hasLayer(vectorLayer)) {
            vectorLayer.addTo(map);
          }
          applyVectorLayerOpacity(vectorLayer, fileConfig.opacity);
        } else {
          const existing = vectorLayersRef.current.get(fileConfig.id);
          if (existing && map.hasLayer(existing)) {
            map.removeLayer(existing);
          }
        }
      } else if (config.type === 'xyz') {
        const xyzConfig = config as XYZLayerConfig;
        
        if (xyzConfig.visible) {
          let tileLayer = tileLayersRef.current.get(xyzConfig.id);
          
          if (!tileLayer) {
            tileLayer = L.tileLayer(xyzConfig.url, {
              attribution: xyzConfig.attribution || xyzConfig.name
            });
            tileLayersRef.current.set(xyzConfig.id, tileLayer);
          }
          
          if (!map.hasLayer(tileLayer)) {
            tileLayer.addTo(map);
          }
          tileLayer.setOpacity(xyzConfig.opacity);
          tileLayer.setZIndex(xyzConfig.zIndex);
        } else {
          const existing = tileLayersRef.current.get(xyzConfig.id);
          if (existing && map.hasLayer(existing)) {
            map.removeLayer(existing);
          }
        }
      }
    });
  }, [mapLoaded, customLayers]);

  // Sync "from" marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (!props.fromMarker) {
      if (fromMarkerRef.current) {
        map.removeLayer(fromMarkerRef.current);
        fromMarkerRef.current = null;
      }
      return;
    }

    if (!fromMarkerRef.current) {
      const marker = L.marker([props.fromMarker.lat, props.fromMarker.lng], {
        icon: stopIcon('from'),
        draggable: true,
        // Draggable by pointer only: a keyboard stop that cannot move the pin
        // would be a dead end in the tab order. Stops are edited in the panel.
        keyboard: false,
        title: 'Startpunkt. Dra for å flytte.'
      }).addTo(map);

      marker.on('dragend', () => {
        const { onUpdateFromMarker } = propsRef.current;
        if (!onUpdateFromMarker) return;
        const latlng = marker.getLatLng();
        onUpdateFromMarker({ lng: latlng.lng, lat: latlng.lat });
      });

      fromMarkerRef.current = marker;
    } else {
      fromMarkerRef.current.setLatLng([props.fromMarker.lat, props.fromMarker.lng]);
    }
  }, [mapLoaded, props.fromMarker]);

  // Sync "to" marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (!props.toMarker) {
      if (toMarkerRef.current) {
        map.removeLayer(toMarkerRef.current);
        toMarkerRef.current = null;
      }
      return;
    }

    if (!toMarkerRef.current) {
      const marker = L.marker([props.toMarker.lat, props.toMarker.lng], {
        icon: stopIcon('to'),
        draggable: true,
        keyboard: false,
        title: 'Destinasjon. Dra for å flytte.'
      }).addTo(map);

      marker.on('dragend', () => {
        const { onUpdateToMarker } = propsRef.current;
        if (!onUpdateToMarker) return;
        const latlng = marker.getLatLng();
        onUpdateToMarker({ lng: latlng.lng, lat: latlng.lat });
      });

      toMarkerRef.current = marker;
    } else {
      toMarkerRef.current.setLatLng([props.toMarker.lat, props.toMarker.lng]);
    }
  }, [mapLoaded, props.toMarker]);

  // Sync waypoint markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    waypointMarkersRef.current.forEach((marker: L.Marker) => map.removeLayer(marker));
    waypointMarkersRef.current = [];

    props.waypoints.forEach((waypoint: MapLngLat, index: number) => {
      const marker = L.marker([waypoint.lat, waypoint.lng], {
        icon: stopIcon('via', String(index + 1)),
        draggable: true,
        keyboard: false,
        title: `Viapunkt ${index + 1}. Dra for å flytte.`
      }).addTo(map);

      marker.on('dragend', () => {
        const { onUpdateWaypoints, waypoints } = propsRef.current;
        if (!onUpdateWaypoints) return;
        const next = [...waypoints];
        const latlng = marker.getLatLng();
        next[index] = { lng: latlng.lng, lat: latlng.lat };
        onUpdateWaypoints(next);
      });

      waypointMarkersRef.current.push(marker);
    });
  }, [mapLoaded, props.waypoints]);

  // Handle street view layer visibility and data
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = streetViewLayerRef.current;
    if (!map || !mapLoaded || !layerGroup) return;

    // Clear existing markers
    streetViewMarkersRef.current.forEach((marker: L.CircleMarker) => layerGroup.removeLayer(marker));
    streetViewMarkersRef.current = [];
    streetViewPointsRef.current = [];

    const streetView = props.config?.streetview;
    if (!props.streetViewVisible || !streetView?.enabled) {
      setStreetViewHint(null);
      return;
    }

    // Removes all currently rendered streetview markers from the layer group.
    const clearStreetViewMarkers = () => {
      streetViewMarkersRef.current.forEach((marker: L.CircleMarker) => layerGroup.removeLayer(marker));
      streetViewMarkersRef.current = [];
      streetViewPointsRef.current = [];
    };

    if (!streetViewRendererRef.current) {
      streetViewRendererRef.current = L.canvas({ padding: 0.5 });
    }
    const renderer = streetViewRendererRef.current;

    // Function to load streetview points from GeoJSON endpoint
    const loadStreetViewPoints = async () => {
      // Abort any previous in-flight load so rapid panning can't stack loads.
      streetViewAbortRef.current?.abort();
      const controller = new AbortController();
      streetViewAbortRef.current = controller;

      const bounds = map.getBounds();
      const view = {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth()
      };
      // Outside the layer's zoom range or coverage there is nothing to show;
      // a country-level view would otherwise fetch and draw every panorama.
      const coverage = streetViewCoverage(map.getZoom(), view, streetView);
      if (coverage !== 'ok') {
        clearStreetViewMarkers();
        setStreetViewHint(STREETVIEW_HINTS[coverage]);
        return;
      }

      try {

        // Use geoJsonUrl if provided, otherwise derive from tilesUrl
        let apiUrl = streetView.geoJsonUrl;
        if (!apiUrl && streetView.tilesUrl) {
          // Convert tiles URL like "/streetview/tiles/{z}/{x}/{y}.mvt" to "/streetview/api/panoramas"
          const baseUrl = streetView.tilesUrl.split('/tiles/')[0];
          apiUrl = `${baseUrl}/api/panoramas`;
        }
        
        if (!apiUrl) {
          console.warn('No streetview API URL configured');
          return;
        }
        
        // Add bounding box parameters
        const params = new URLSearchParams({
          west: bounds.getWest().toString(),
          south: bounds.getSouth().toString(),
          east: bounds.getEast().toString(),
          north: bounds.getNorth().toString()
        });
        
        const url = apiUrl.includes('?') 
          ? `${apiUrl}&${params.toString()}`
          : `${apiUrl}?${params.toString()}`;

        const response = await fetchWithTimeout(url, { signal: controller.signal });
        if (!response.ok) {
          console.warn('Failed to load street view points:', response.status);
          propsRef.current.onStreetViewLoadError?.();
          return;
        }

        const geojson = await response.json();
        if (controller.signal.aborted) return;

        if (!geojson.features || !Array.isArray(geojson.features)) {
          return;
        }

        // Build the new marker set first, then swap it in, so the points
        // don't blink away while a pan is loading.
        const nextMarkers: L.CircleMarker[] = [];
        const nextPoints: StreetViewEventDetail[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geojson.features.forEach((feature: any) => {
          if (feature.geometry?.type !== 'Point') return;
          
          const [lng, lat] = feature.geometry.coordinates;
          const id = feature.properties?.id || feature.id;
          
          const marker = L.circleMarker([lat, lng], {
            renderer,
            radius: streetView.circleRadius ?? 6,
            fillColor: streetView.circleColor ?? mapColors.streetviewFill,
            color: streetView.circleStrokeColor ?? mapColors.streetviewStroke,
            weight: streetView.circleStrokeWidth ?? 2,
            fillOpacity: streetView.circleOpacity ?? 0.85
          });

          const detail: StreetViewEventDetail | null = id
            ? { id: String(id), lngLat: { lng, lat }, geometry: feature.geometry, properties: feature.properties || {} }
            : null;
          if (detail) nextPoints.push(detail);

          marker.on('click', (e: L.LeafletMouseEvent) => {
            // Stop propagation to prevent map click handler from triggering geocode
            L.DomEvent.stopPropagation(e);
            const { onStreetViewSelect } = propsRef.current;
            if (onStreetViewSelect && detail) onStreetViewSelect(detail);
          });

          marker.on('mouseover', () => {
            marker.setStyle({ fillOpacity: 1, radius: (streetView.circleRadius ?? 6) + 2 });
          });

          marker.on('mouseout', () => {
            marker.setStyle({ 
              fillOpacity: streetView.circleOpacity ?? 0.85, 
              radius: streetView.circleRadius ?? 6 
            });
          });

          nextMarkers.push(marker);
        });

        clearStreetViewMarkers();
        nextMarkers.forEach((marker) => marker.addTo(layerGroup));
        streetViewMarkersRef.current = nextMarkers;
        streetViewPointsRef.current = nextPoints;
        setStreetViewHint(nextMarkers.length === 0 ? STREETVIEW_HINTS.outside : null);
      } catch (error) {
        // Ignore aborts triggered by a newer load or effect teardown.
        if (controller.signal.aborted) return;
        console.error('Error loading street view points:', error);
        propsRef.current.onStreetViewLoadError?.();
      }
    };

    // Load points initially and on map move
    loadStreetViewPoints();

    const handleMoveEnd = () => {
      if (propsRef.current.streetViewVisible) {
        loadStreetViewPoints();
      }
    };

    map.on('moveend', handleMoveEnd);
    map.on('zoomend', handleMoveEnd);

    return () => {
      map.off('moveend', handleMoveEnd);
      map.off('zoomend', handleMoveEnd);
      streetViewAbortRef.current?.abort();
      streetViewAbortRef.current = null;
    };
  }, [mapLoaded, props.streetViewVisible, props.config?.streetview]);

  const toolArmed = measureMode !== 'none' || avoidDrawing;

  // The armed-tool banner sits where toasts stack; while it is shown they start
  // below it instead of covering its instruction (lib/toastClearance.ts).
  const toolBannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const banner = toolBannerRef.current;
    if (!toolArmed || !banner) return;
    const place = () => setToastClearance('tool-banner', banner.getBoundingClientRect().bottom);
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(banner);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      setToastClearance('tool-banner', null);
    };
  }, [toolArmed]);
  const toolMinPoints = avoidDrawing ? 3 : measureMode === 'distance' ? 2 : 3;
  // Keyboard users arm a tool from the Verktøy card and continue on the map,
  // so the map takes focus when a tool is armed and after it finishes. A
  // mouse click still shows no ring: programmatic focus after a pointer
  // interaction does not match :focus-visible.
  const focusMap = () => mapRef.current?.getContainer().focus({ preventScroll: true });
  const cancelArmedTool = () => {
    if (measureModeRef.current !== 'none') setMeasureMode('none');
    if (avoidDrawingRef.current) setAvoidDrawing(false);
  };
  const bannerButtonClass = `rounded-md border border-current px-3 py-1 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
    avoidDrawing
      ? 'hover:bg-danger-base-hover focus-visible:ring-offset-danger-base-default'
      : 'hover:bg-info-base-hover focus-visible:ring-offset-info-base-default'
  }`;

  const toolName = avoidDrawing ? 'Unngå område.' : measureMode === 'area' ? 'Mål areal.' : 'Mål avstand.';

  // Imperative handle for parent component
  React.useImperativeHandle(
    ref,
    () => ({
      focus() {
        focusMap();
      },
      cancelTool() {
        const cancelled = measureModeRef.current !== 'none' || avoidDrawingRef.current;
        cancelArmedTool();
        return cancelled;
      },
      clearMeasurement() {
        clearMeasurementRef.current();
      },
      lookupAt(coords: MapLngLat) {
        void lookupAtRef.current?.(coords.lat, coords.lng);
      },
      jumpToBoundingBox(bbox: [number, number, number, number]) {
        const map = mapRef.current;
        if (map) fitAnswer(map, bbox);
      },
      revealBoundingBox(bbox: [number, number, number, number]) {
        const map = mapRef.current;
        if (!map) return;
        const { paddingTopLeft, paddingBottomRight } = answerFramePadding();
        const size = map.getSize();
        const southWest = map.latLngToContainerPoint([bbox[1], bbox[0]]);
        const northEast = map.latLngToContainerPoint([bbox[3], bbox[2]]);
        const inFrame =
          southWest.x >= paddingTopLeft[0] &&
          northEast.y >= paddingTopLeft[1] &&
          northEast.x <= size.x - paddingBottomRight[0] &&
          southWest.y <= size.y - paddingBottomRight[1];
        if (!inFrame) fitAnswer(map, bbox);
      },
      jumpToFeature(feature: GeoJSONFeature) {
        const map = mapRef.current;
        if (!map) return;
        // Points zoom in; anything with a real extent (a polygon, or a point
        // whose bbox says it stands for an area) is fitted instead.
        const view = resolveFeatureView(feature);
        if (!view) return;
        if (view.kind === 'point') {
          map.setView([view.lat, view.lng], view.zoom);
        } else {
          const bounds: LatLngBoundsExpression = view.bounds;
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
        }
      },
      jumpToCoordinates(coords: MapLngLat) {
        const map = mapRef.current;
        if (!map) return;
        map.setView([coords.lat, coords.lng], 18);
      },
      revealOverpassFeature(index: number) {
        const map = mapRef.current;
        const marker = overpassNumberRef.current.get(index);
        if (!map || !marker) return;
        // Clear the rail on the left (search, card and results) and the
        // controls on the right, panning only as far as that needs.
        map.panInside(marker.getLatLng(), answerFramePadding());
      },
      highlightOverpassFeature(index: number | null) {
        const selectedIndex = propsRef.current.selectedOverpassIndex;
        overpassNumberRef.current.forEach((marker, i) => {
          const active = i === index;
          marker.getElement()?.classList.toggle('is-active', active);
          marker.setZIndexOffset(i === selectedIndex ? 2000 : active ? 1000 : 0);
          if (active) marker.openTooltip();
          else marker.closeTooltip();
        });
      },
      clearFeature() {
        // Feature layers will be cleared via useEffect when props change
      },
      project(coord: MapLngLat) {
        const map = mapRef.current;
        if (!map) {
          return { x: 0, y: 0 };
        }
        const point = map.latLngToContainerPoint([coord.lat, coord.lng]);
        return { x: point.x, y: point.y };
      },
      getBounds() {
        const map = mapRef.current;
        if (!map) return null;
        const bounds = map.getBounds();
        return {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest()
        };
      },
      fitBounds(bounds: [[number, number], [number, number]], options?: { padding?: number }) {
        const map = mapRef.current;
        if (!map) return;
        const leafletBounds: LatLngBoundsExpression = [
          [bounds[0][1], bounds[0][0]],
          [bounds[1][1], bounds[1][0]]
        ];
        map.fitBounds(leafletBounds, { padding: [options?.padding ?? 0, options?.padding ?? 0] });
      }
    }),
    []
  );

  // Destructure the props the style-change callback depends on, so its deps are
  // concrete values rather than the whole `props` object (react-hooks/exhaustive-deps).
  const { mapStyles, onStyleChange } = props;
  const stylesForToggle = mapStyles.length ? mapStyles : defaultMapStyles;

  // Handle style changes
  const handleStyleChange = useCallback((newStyleUrl: string) => {
    const map = mapRef.current;
    if (!map) return;

    setCurrentStyleUrl(newStyleUrl);

    // Remove current tile layer
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    // Find the matching style to get attribution
    const allStyles = mapStyles.length ? mapStyles : defaultMapStyles;
    const selectedStyle = allStyles.find((style: MapStyle) => style.url === newStyleUrl);
    const attribution = plainAttribution(selectedStyle?.attribution || OSM_CREDIT);

    // Create new tile layer with the style URL (which is now a tile URL template)
    const newTileLayer = L.tileLayer(newStyleUrl, {
      attribution,
      maxZoom: 19
    });
    watchBasemapTiles(newTileLayer, () => propsRef.current.onBasemapError?.(selectedStyle?.name ?? ''));

    newTileLayer.addTo(map);
    tileLayerRef.current = newTileLayer;

    // Notify parent (by style id) so the URL hash can be updated.
    if (selectedStyle?.id) {
      onStyleChange?.(selectedStyle.id);
    }
  }, [mapStyles, onStyleChange]);

  // Layers the user has added and switched on (an OGC service counts each enabled sub-layer).
  const activeLayerCount = customLayers.reduce((count, l) => {
    if (l.type === 'ogc-service') {
      return count + (l as OGCServiceConfig).layers.filter((sl) => sl.enabled).length;
    }
    return count + ((l as FileLayerConfig | XYZLayerConfig).visible ? 1 : 0);
  }, 0);

  // "Gatebilde" is offered only when a street-view source is configured: one
  // definition, shared with App's layer toggle and its teaching line.
  const streetViewAvailable = isStreetViewConfigured(props.config?.streetview);

  return (
    <div className="relative h-screen w-screen">
      <div
        ref={containerRef}
        role="application"
        aria-label={`Kart. Klikk på et punkt, eller trykk Enter for midten av kartet, for å se adressen.${
          props.streetViewVisible ? ' Med Gatebilde på åpner Enter gatebildet nærmest midten.' : ''
        } Høyreklikk eller Shift+F10 åpner kartvalg. Piltastene flytter kartet, + og − zoomer.`}
        className="fixed left-0 top-0 h-screen w-screen"
      />
      {/* The centre of the map: where Enter asks "what is here?" and, while
          a tool is armed, where Space adds a vertex. Shown by CSS only while
          the map has keyboard focus (see .map-crosshair in app.css). */}
      <div
        className={`map-crosshair pointer-events-none fixed left-1/2 top-1/2 z-controls -translate-x-1/2 -translate-y-1/2 ${
          avoidDrawing
            ? 'text-danger-base-default'
            : toolArmed
              ? 'text-info-base-default'
              : 'text-base-default'
        }`}
        aria-hidden="true"
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="16" cy="16" r="9" />
          <path d="M16 2v8M16 22v8M2 16h8M22 16h8" strokeLinecap="round" />
        </svg>
      </div>
      
      {/* Style selector */}
      {stylesForToggle.length > 1 && (
        <div className="pointer-events-none absolute right-4 top-4 z-controls">
          <div className="pointer-events-auto flex items-center gap-2">
            {props.topRightSlot}
            {/* Layer Manager button */}
            <button
              onClick={() => setShowLayerManager(true)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-default bg-surface-default shadow-sm hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
              title="Kartlag"
              aria-label="Kartlag"
            >
              <LayersIcon className="h-5 w-5 text-text-subtle" />
            </button>
            
            {/* Style selector dropdown */}
            <div className="relative w-52">
              <select
                aria-label="Bakgrunnskart"
                value={currentStyleUrl}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                  handleStyleChange(event.target.value)
                }
                className="h-10 w-full appearance-none rounded-lg border border-border-default bg-surface-default px-4 pr-10 text-sm text-text-default shadow-sm transition focus:border-base-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
              >
                {stylesForToggle.map((style: MapStyle) => (
                  <option key={style.id ?? style.url} value={style.url}>
                    {style.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-text-subtle">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Layer Manager button (shown when no style selector) */}
      {stylesForToggle.length <= 1 && (
        <div className="pointer-events-none absolute right-4 top-4 z-controls">
          <div className="pointer-events-auto flex items-center gap-2">
          {props.topRightSlot}
          <button
            onClick={() => setShowLayerManager(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-default bg-surface-default shadow-sm hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
            title="Kartlag"
            aria-label="Kartlag"
          >
            <LayersIcon className="h-5 w-5 text-text-subtle" />
          </button>
          </div>
        </div>
      )}

      {/* Custom layers indicator: it counts what is drawn on the map, so it
          never reads "0 egne kartlag"; hidden layers stay listed in Kartlag. */}
      {activeLayerCount > 0 && (
        <div className="pointer-events-none absolute right-4 top-16 z-controls">
          {/* It looks like a control, so it is one: it opens Kartlag. */}
          <button
            type="button"
            onClick={() => setShowLayerManager(true)}
            aria-label={`${activeLayerCount === 1 ? '1 eget kartlag' : `${activeLayerCount} egne kartlag`}, åpne Kartlag`}
            title="Åpne Kartlag"
            className="pointer-events-auto rounded-lg border border-border-default bg-surface-default px-3 py-1.5 text-xs text-text-subtle shadow-sm transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
          >
            {activeLayerCount === 1 ? '1 eget kartlag' : `${activeLayerCount} egne kartlag`}
          </button>
        </div>
      )}

      <MapTools
        measureMode={measureMode}
        onMeasureModeChange={(mode) => {
          setMeasureMode(mode);
          if (mode !== 'none') focusMap();
        }}
        showAvoidTool={Boolean(props.navigationMode)}
        avoidDrawing={avoidDrawing}
        onAvoidDrawingChange={(drawing) => {
          setAvoidDrawing(drawing);
          if (drawing) focusMap();
        }}
        streetViewAvailable={streetViewAvailable}
        streetViewVisible={props.streetViewVisible}
        onToggleStreetView={() => props.onToggleStreetView?.()}
        streetViewHint={props.streetViewVisible ? (streetViewHint ?? STREETVIEW_KEYBOARD_HINT) : null}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        measurement={lastMeasurement}
        onClearMeasurement={() => clearMeasurementRef.current()}
      />

      {/* Armed-tool banner: what to do, what you have, and the two buttons a
          mouse user gets instead of the keys. Sits in the map area to the
          right of the rail so it never covers the route panel. */}
      {toolArmed && (
        <div className="tool-banner pointer-events-none absolute left-[35rem] right-4 top-20 z-dialog flex justify-center">
          <div
            ref={toolBannerRef}
            className={`pointer-events-auto max-w-xl rounded-lg px-4 py-2 text-sm shadow-lg ${
              avoidDrawing
                ? 'bg-danger-base-default text-danger-base-contrast-default'
                : 'bg-info-base-default text-info-base-contrast-default'
            }`}
          >
            {/* The instruction, headed by the tool's name: for the pointer by
                default, for the keys while the map has keyboard focus. Both
                variants share one grid cell (.tool-hints in app.css), so the
                banner keeps its height when focus leaves the map and Fullfør
                and Avbryt never move between press and release. */}
            <p role="status" className="tool-hints text-center text-xs">
              <span className="tool-hint-pointer">
                <span className="font-medium">{toolName}</span>{' '}
                {avoidDrawing
                  ? 'Klikk i kartet for å tegne området som skal unngås. Esc avbryter.'
                  : 'Klikk i kartet for å legge til punkter. Esc avbryter.'}
              </span>
              <span className="tool-hint-keys">
                <span className="font-medium">{toolName}</span>{' '}
                Piltastene flytter kartet, mellomrom setter punkt, Backspace angrer, Enter fullfører, Esc avbryter.
              </span>
            </p>
            <div className="mt-1.5 flex items-center justify-center gap-3">
              <span role="status" className="font-medium tabular-nums">
                {toolStatus.count === 0
                  ? 'Ingen punkter ennå'
                  : `${toolStatus.count} ${toolStatus.count === 1 ? 'punkt' : 'punkter'}${
                      toolStatus.summary ? ` · ${toolStatus.summary}` : ''
                    }`}
              </span>
              <button
                type="button"
                onClick={() => {
                  (avoidKeysRef.current ?? measureKeysRef.current)?.finish();
                  focusMap();
                }}
                disabled={toolStatus.count < toolMinPoints}
                title={toolStatus.count < toolMinPoints ? `Minst ${toolMinPoints === 2 ? 'to' : 'tre'} punkter` : undefined}
                className={bannerButtonClass}
              >
                Fullfør
              </button>
              <button
                type="button"
                onClick={() => {
                  cancelArmedTool();
                  focusMap();
                }}
                className={bannerButtonClass}
              >
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Layer Manager Modal */}
      {showLayerManager && (
        <LayerManager
          layers={customLayers}
          onLayersChange={setCustomLayers}
          onClose={() => setShowLayerManager(false)}
        />
      )}
    </div>
  );
});

MapComponent.displayName = 'Map';

export default MapComponent;
