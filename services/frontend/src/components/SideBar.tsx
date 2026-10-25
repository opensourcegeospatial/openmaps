import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@mattilsynet/design/react';
import type { GeoJSONFeature } from '../lib/nominatim';
import type { RouteVisibility } from './Map';
import type { RouteFeatureCollection, RouteResult } from '../lib/graphhopper';
import type { MapLngLat } from './Map';
import type { Geometry } from 'geojson';
import NavigationPanel, { type StopFocusRequest } from './NavigationPanel';
import CopyButton from './CopyButton';
import { PROFILE_LABELS, ROUTING_STATUS_MESSAGES, type RoutingProfile, type RoutingStatus } from '../lib/routingStatus';
import { getDetailRows, getExtraTags, getPlaceTitle } from '../lib/featureDetails';
import { formatKm, formatMinutes } from '../lib/format';
import type { WaypointLocation } from '../lib/locations';
import { useIsClamped } from '../hooks/useIsClamped';
import { getFocusable } from '../hooks/useFocusTrap';
import UndoNotice from './UndoNotice';
import RouteDetails from './RouteDetails';
import { EMPTY_HIGHLIGHT, type RouteHighlight } from '../lib/routeDetails';

interface RouteInstruction {
  text: string;
  distance?: number;
  time?: number;
  interval?: [number, number];
  [key: string]: unknown;
}

export interface LocationWithName {
  coords: MapLngLat;
  name: string;
}

interface SideBarProps {
  feature: GeoJSONFeature | null;
  /** Shown under the name when the point has coordinates but no address. */
  featureNote?: string | null;
  /** Ask the map for this point's address again, when the last answer failed. */
  onRetryFeature?: () => void;
  routeFeature: RouteFeatureCollection | null;
  /** All returned routes (primary first), or null when none. */
  routes: RouteResult[] | null;
  /** Loading/empty/error state of the routing request. */
  routingStatus: RoutingStatus;
  /** Specific (Norwegian) failure reason from the backend, when known. */
  routingErrorMessage?: string | null;
  /** Index of the currently active route. */
  selectedRouteIndex: number;
  /** Activate a route by its route_index. */
  onSelectRoute: (routeIndex: number) => void;
  /** Re-run the last routing request after a failure ("Prøv igjen"). */
  onRetryRoute?: () => void;
  /** Frame the active route on the map ("Vis ruten"). */
  onShowRoute?: () => void;
  /** How much of the drawn route the map's view shows. */
  routeVisibility?: RouteVisibility;
  /** What the route details point at on the map (lifted to App, which draws it). */
  routeHighlight?: RouteHighlight;
  onRouteHighlightChange?: React.Dispatch<React.SetStateAction<RouteHighlight>>;
  /** Whether alternative-route requests are enabled. */
  alternativesEnabled: boolean;
  /** Toggle alternative-route requests. */
  onToggleAlternatives: (enabled: boolean) => void;
  /** Number of active avoid-area polygons. */
  avoidAreasCount: number;
  /** Remove all avoid-area polygons. */
  onClearAvoidAreas: () => void;
  navigationMode: boolean;
  fromLocation: LocationWithName | null;
  toLocation: LocationWithName | null;
  waypointLocations: WaypointLocation[];
  routingProfile: RoutingProfile;
  /** The travel mode of the route now drawn, when one is. */
  routeProfile?: RoutingProfile | null;
  onClose: () => void;
  onJumpTo: (coords: MapLngLat) => void;
  onNavigateFrom: (coords: MapLngLat) => void;
  onNavigateTo: (coords: MapLngLat) => void;
  /** Add the place as a via point; offered on the card while a route is planned. */
  onAddWaypoint?: (coords: MapLngLat) => void;
  onStartNavigation: () => void;
  onFromChange: (location: LocationWithName | null) => void;
  onToChange: (location: LocationWithName | null) => void;
  onWaypointsChange: (waypoints: WaypointLocation[]) => void;
  onProfileChange: (profile: RoutingProfile) => void;
  onSwapLocations: () => void;
  onCloseNavigation: () => void;
  /** Whether the card takes focus on the place's name when it opens. */
  focusOnOpen?: boolean;
  /** Whether `feature` is in "Mine steder"; drives the star button. */
  isSaved?: boolean;
  /** Toggle `feature` in "Mine steder". The star is hidden when absent. */
  onToggleSaved?: () => void;
  /** Put focus in a stop field of the route panel (see NavigationPanel). */
  focusStop?: StopFocusRequest;
  /**
   * The card shares the rail with the results list a hit came from. It then
   * keeps only what identifies the place and what can be done with it, and
   * folds its facts behind "Vis detaljer", so hits stay comparable above it.
   */
  compact?: boolean;
  /**
   * Reports whether the compact card's facts are unfolded. Expanding is a
   * request to read them, so the shell lets the card outrank the list while
   * it is true — without that the card grew by 3px and hid 371 (run 10).
   */
  onExpandedChange?: (expanded: boolean) => void;
}

const isLngLatTuple = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number' &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);

const extendBounds = (bounds: [number, number, number, number], coord: [number, number]) => {
  const [lng, lat] = coord;
  bounds[0] = Math.min(bounds[0], lng);
  bounds[1] = Math.min(bounds[1], lat);
  bounds[2] = Math.max(bounds[2], lng);
  bounds[3] = Math.max(bounds[3], lat);
};

const walkCoordinates = (
  input: unknown,
  bounds: [number, number, number, number],
  state: { hasCoords: boolean }
) => {
  if (isLngLatTuple(input)) {
    extendBounds(bounds, input);
    state.hasCoords = true;
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => walkCoordinates(item, bounds, state));
  }
};

const computeGeometryCenter = (geometry: Geometry | null | undefined): MapLngLat | null => {
  if (!geometry) return null;
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const state = { hasCoords: false };

  const processGeometry = (geom: Geometry) => {
    if (geom.type === 'GeometryCollection') {
      geom.geometries?.forEach(processGeometry);
      return;
    }
    if ('coordinates' in geom) {
      walkCoordinates((geom as { coordinates: unknown }).coordinates, bounds, state);
    }
  };

  processGeometry(geometry);
  if (!state.hasCoords) return null;
  const [minLng, minLat, maxLng, maxLat] = bounds;
  return {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2
  };
};

// Norwegian number formats (comma decimals, metres under a kilometre, hours
// spelled out) shared with the measurement popups and toasts.
const formatDistance = formatKm;
const formatTimeMinutes = formatMinutes;

/** A value the user may carry elsewhere, with "Kopier" beside it. */
const CopyableValue: React.FC<{ value: string }> = ({ value }) => {
  const valueRef = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={valueRef} className="min-w-0 select-all break-all">
        {value}
      </span>
      <CopyButton
        text={value}
        icon={false}
        selectRef={valueRef}
        className="shrink-0 rounded text-xs font-medium text-text-subtle underline transition hover:text-text-default hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
      />
    </>
  );
};

/** The one close glyph: a 20px line icon, like every other panel header. */
const CloseIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const closeButtonClass =
  'rounded-full p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default';

/**
 * The condensed bar's height (`data-panel-bar`): the 28px close button, 10px
 * above and below it, and its 1px rule. The panel scrolls nothing in under it,
 * and the route summary counts as readable only below it.
 */
const PANEL_BAR_HEIGHT = 49;

/**
 * Bring a routing failure into view: its banner, then (when the last route is
 * kept) that route's numbers below it, each only as far as needed. Coming from
 * below, the numbers rise clear of the fade and the banner comes along above
 * them; coming from above, the banner drops in clear of the condensed bar and
 * the numbers follow. Scrolled to alone, the numbers came along only from
 * below: from above, after a card was closed over a panel scrolled down, they
 * landed under the bar with 0 of the banner's 112px in view (polish, critique
 * run 14).
 */
function revealFailure(banner: HTMLElement | null, keptNumbers: HTMLElement | null): void {
  banner?.scrollIntoView?.({ block: 'nearest' });
  keptNumbers?.scrollIntoView?.({ block: 'nearest' });
}

const SideBar: React.FC<SideBarProps> = ({
  focusOnOpen = true,
  feature,
  featureNote = null,
  onRetryFeature,
  routeFeature,
  routes,
  routingStatus,
  routingErrorMessage,
  selectedRouteIndex,
  onSelectRoute,
  onRetryRoute,
  onShowRoute,
  routeVisibility = 'whole',
  routeHighlight = EMPTY_HIGHLIGHT,
  onRouteHighlightChange,
  alternativesEnabled,
  onToggleAlternatives,
  avoidAreasCount,
  onClearAvoidAreas,
  navigationMode,
  fromLocation,
  toLocation,
  waypointLocations,
  routingProfile,
  routeProfile = null,
  onClose,
  onJumpTo,
  onNavigateFrom,
  onNavigateTo,
  onAddWaypoint,
  onStartNavigation,
  onFromChange,
  onToChange,
  onWaypointsChange,
  onProfileChange,
  onSwapLocations,
  onCloseNavigation,
  isSaved = false,
  onToggleSaved,
  focusStop,
  compact = false,
  onExpandedChange
}: SideBarProps) => {
  // The active route — prefer the selected entry from `routes`, falling back to
  // the primary feature of the derived FeatureCollection (legacy/no-list case).
  const activeRoute = useMemo<RouteResult | null>(() => {
    if (routes && routes.length > 0) {
      return routes.find((r) => r.routeIndex === selectedRouteIndex) ?? routes[0];
    }
    return null;
  }, [routes, selectedRouteIndex]);

  const routeSummary = useMemo(() => {
    if (activeRoute) {
      return {
        distance: activeRoute.distance ?? 0,
        time: activeRoute.time ?? 0,
        instructions: Array.isArray(activeRoute.instructions)
          ? (activeRoute.instructions as RouteInstruction[])
          : []
      };
    }
    // Fallback to the derived FeatureCollection primary feature.
    const primary = routeFeature?.features?.[0];
    if (!primary) return null;
    const props = primary.properties as Record<string, unknown> | undefined;
    if (!props) return null;
    const distance = typeof props.distance === 'number' ? props.distance : Number(props.distance);
    const time = typeof props.time === 'number' ? props.time : Number(props.time);
    const instructions = Array.isArray(props.instructions)
      ? (props.instructions as RouteInstruction[])
      : [];
    return { distance: distance ?? 0, time: time ?? 0, instructions };
  }, [activeRoute, routeFeature]);

  // A failed recalculation keeps the previous route while the pressed travel
  // mode is the one that failed. Name that route's mode, so its distance and
  // time are never read as an answer to the mode now pressed.
  const staleRoute =
    routingStatus === 'error' && routeSummary && routeProfile && routeProfile !== routingProfile
      ? PROFILE_LABELS[routeProfile]
      : null;

  const handleStepClick = (instruction: RouteInstruction) => {
    if (!instruction.interval) return;
    const [start] = instruction.interval;
    const geometry =
      activeRoute?.geometry ??
      (routeFeature?.features?.[0]?.geometry as Geometry | undefined);
    if (!geometry || geometry.type !== 'LineString') return;
    const coordinates = geometry.coordinates as [number, number][];
    const target = coordinates[start];
    if (target) {
      onJumpTo({ lng: target[0], lat: target[1] });
    }
  };

  // A newly opened details card takes focus on the place's name, so a screen
  // reader announces what opened and keyboard users start inside it; unless
  // the answer arrived after the user moved on, when it is announced instead
  // and focus stays where they put it.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!feature) {
      setAnnouncement('');
      return;
    }
    if (focusOnOpen) {
      headingRef.current?.focus({ preventScroll: true });
      setAnnouncement('');
    } else {
      setAnnouncement(`Detaljer: ${getPlaceTitle(feature).title}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature]);

  // On a long route panel the summary scrolls away; while it is not wholly
  // readable a bar at the panel's foot repeats distance and time and brings
  // it back. Wholly readable means clear of the 24px fade at the foot and of
  // the 49px condensed bar at the top (`data-panel-bar`), hence the margins.
  // Counted as in view while any sliver showed, the summary sat half under
  // the panel's edge with no bar: 16 of the 27px of "5,4 km" at 1280×720
  // beside a hit list, none of them clear of the fade (critique run 14).
  const asideRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryInView, setSummaryInView] = useState(true);
  useEffect(() => {
    const target = summaryRef.current;
    const root = asideRef.current;
    if (!target || !root || typeof IntersectionObserver === 'undefined') {
      setSummaryInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setSummaryInView(entry.intersectionRatio >= 0.99),
      { root, rootMargin: `-${PANEL_BAR_HEIGHT}px 0px -24px 0px`, threshold: [0, 0.99, 1] }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [routeSummary, navigationMode]);

  // A panel taller than the room the rail leaves it scrolls inside itself;
  // while more of it lies below, a hairline band at its foot says so, since
  // overlay scrollbars show nothing at rest. The content's own 24px bottom
  // padding hidden below is not "more".
  const contentRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const root = asideRef.current;
    if (!root) return;
    // The content's own bottom padding hidden below the fold is not "more".
    // The threshold matches that padding, so the cue goes once only padding
    // remains and never sits over the last line of real content.
    const update = () => setMoreBelow(root.scrollHeight - root.scrollTop - root.clientHeight > 32);
    update();
    root.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(root);
    if (contentRef.current) observer?.observe(contentRef.current);
    return () => {
      root.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  // A panel taller than the rail scrolls its own header away, taking the title
  // and the way out with it. While that header is out of sight, a condensed bar
  // keeps both at the panel's top edge (critique run 7).
  const [headerInView, setHeaderInView] = useState(true);
  useEffect(() => {
    const root = asideRef.current;
    const target = root?.querySelector<HTMLElement>('[data-panel-header]');
    if (!root || !target || typeof IntersectionObserver === 'undefined') {
      setHeaderInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setHeaderInView(entry.isIntersecting), {
      root,
      threshold: 0.5
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [feature, navigationMode, routeSummary]);

  // A failure is the one thing in the panel that must not be read half: bring
  // the banner into view when it appears, however far down the panel sits.
  // A failed recalculation keeps the previous route and the banner says so
  // ("Viser forrige rute"), so what must be seen is the banner and the summary
  // it points at (see `revealFailure`). Scrolling the banner alone, with a
  // bottom margin reserved for the summary, never fired: `nearest` does
  // nothing for an element already in view, margin or not, and left the
  // numbers 14px below the panel on a three-stop route (critique run 11).
  //
  // Only when a failure is NEW. A failure already standing when this panel
  // renders (or re-renders) was seen when it arrived; scrolled to again, it
  // pulled the panel away from a card the user had just opened above it and
  // left that card 0px visible, focus on its hidden name (critique run 12).
  const alertRef = useRef<HTMLDivElement>(null);
  const failureKeepsRoute = routingStatus === 'error' && Boolean(routeSummary);
  const failureKey =
    routingStatus === 'error' || routingStatus === 'empty' ? `${routingStatus}:${routingErrorMessage ?? ''}` : null;
  const shownFailure = useRef(failureKey);
  // A failure that arrived while a card was open above the route, still to be
  // brought into view once that card closes.
  const unseenFailure = useRef(false);
  useEffect(() => {
    if (failureKey === shownFailure.current) return;
    shownFailure.current = failureKey;
    unseenFailure.current = false;
    if (!failureKey) return;
    // Nor while a card is open above the route: the failure is announced (the
    // banner is an alert) and waits below the card. Scrolled to, it took away
    // the card the user had just asked for, 0px left in view, when a slow
    // router answered after the card opened (critique run 13).
    if (feature) {
      unseenFailure.current = true;
      return;
    }
    revealFailure(alertRef.current, failureKeepsRoute ? summaryRef.current : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `feature` only gates this; a card opening is not a failure
  }, [failureKey, failureKeepsRoute]);
  // "Prøv igjen" replaces the banner it sits in: the retry runs through
  // `loading`, which unmounts the button under the user, and focus fell on the
  // page — at the moment of recovery, in a panel that costs dozens of Tab
  // presses to climb back into (critique run 15). When the status settles,
  // focus goes to whatever answers: the new banner's own retry, or the numbers
  // a route that worked produced. Only when the retry dropped focus; a user
  // who has moved on keeps where they are.
  const retryFocusRef = useRef(false);
  useEffect(() => {
    if (!retryFocusRef.current || routingStatus === 'loading') return;
    retryFocusRef.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const again = alertRef.current?.querySelector<HTMLButtonElement>('button');
    (again ?? summaryRef.current)?.focus();
  }, [routingStatus]);

  // ...and when the card closes, the failure it held back comes into view.
  // Held back for good, it left only "Sykle" pressed over a Kjør route as a
  // clue, with 0 of the banner's 112px in view (critique run 14).
  useEffect(() => {
    if (feature || !unseenFailure.current) return;
    unseenFailure.current = false;
    if (!failureKey) return;
    revealFailure(alertRef.current, failureKeepsRoute ? summaryRef.current : null);
  }, [feature, failureKey, failureKeepsRoute]);

  // This panel stays mounted while cards come and go at its top (App renders
  // it in one place), so a card opened over a route panel scrolled down to
  // its steps would open out of sight. A new card brings the panel to its top,
  // where the card is.
  useEffect(() => {
    if (feature) asideRef.current?.scrollTo?.({ top: 0 });
  }, [feature]);

  const featureCenter = useMemo(() => computeGeometryCenter(feature?.geometry), [feature]);
  // The headline is the place as people say it (its name, else its street
  // address); an address row that would only repeat the headline goes, and
  // the locality sits under the headline when no address row says where.
  const placeTitle = useMemo(() => (feature ? getPlaceTitle(feature) : null), [feature]);
  const detailRows = useMemo(() => (feature ? getDetailRows(feature) : []), [feature]);
  // The category becomes the Label above the name, not a row among the facts.
  const placeType = detailRows.find((row) => row.label === 'Kategori')?.value;
  const factRows = detailRows.filter(
    (row) => row.label !== 'Kategori' && !(placeTitle?.titleIsAddress && row.label === 'Adresse')
  );
  const showLocality = Boolean(placeTitle?.locality) && !factRows.some((row) => row.label === 'Adresse');
  // Under the name, what it is and where, on one subtle line as in the search
  // results ("Kafé · 0184 Oslo"), never as a label above it.
  const placeMeta = [placeType, showLocality ? placeTitle?.locality : null].filter(Boolean).join(' · ');
  // A lookup that failed still gives the point itself: its coordinates are the
  // headline, and the one thing worth carrying away from it.
  const titleIsCoordinates = Boolean(placeTitle?.title.includes('°'));
  const extraTags = useMemo(() => (feature ? getExtraTags(feature) : []), [feature]);
  const knownTags = extraTags.filter((tag) => !tag.raw);
  const rawTags = extraTags.filter((tag) => tag.raw);
  // A name long enough to fill the card on its own must not push the facts out
  // of it. The headline stops at three lines; the full name stays in the DOM,
  // so it is still the card's heading for a screen reader, and a tooltip
  // carries it for the pointer. Balanced wrapping and the clamp cannot both be
  // live on one element (the clamp needs `-webkit-box`, which makes
  // `text-balance` inert), and they never need to be: a clamped headline fills
  // every line it has, so there is nothing left to balance.
  // Compact, the card is identity and next step: two lines name it, and the
  // rest is a click away. Expanded, it gets the full three.
  const titleClamped = useIsClamped(headingRef, compact ? 2 : 3, placeTitle?.title);

  // While the card is compact its facts are folded; a different hit folds them
  // again, so the list's height never depends on which row was opened last.
  const [factsOpen, setFactsOpen] = useState(false);
  useEffect(() => {
    setFactsOpen(false);
  }, [feature]);
  const hasFacts = factRows.length > 0 || extraTags.length > 0;
  const factsVisible = !compact || factsOpen;

  // Tell the shell, so the rail can hand the room to the card while its facts
  // are open and take it back when they fold. A layout effect, so the shell's
  // re-render lands before the browser paints and the card already has its
  // new height when the scroll below runs. From a plain effect that re-render
  // raced the frame the scroll waits for: in about one expansion in six the
  // facts were scrolled inside the old, short card, leaving it pinned to its
  // bottom (4-5 in 30, critique run 11).
  useLayoutEffect(() => {
    onExpandedChange?.(compact && factsOpen);
  }, [compact, factsOpen, onExpandedChange]);

  // The card is at its new height by now (above); a frame lets the revealed
  // facts lay out before they are scrolled to.
  const factsRef = useRef<HTMLDListElement>(null);
  useEffect(() => {
    if (!factsOpen || typeof requestAnimationFrame === 'undefined') return;
    const id = requestAnimationFrame(() =>
      factsRef.current?.scrollIntoView?.({ block: 'nearest' })
    );
    return () => cancelAnimationFrame(id);
  }, [factsOpen]);

  const canNavigate = Boolean(feature && featureCenter);
  const navigateButtonClass = `w-full rounded-lg border border-main-border-default px-3 py-2 text-sm font-medium text-main-text-default transition hover:bg-main-surface-tinted hover:border-main-border-strong hover:text-main-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default ${    canNavigate ? '' : 'cursor-not-allowed opacity-50 hover:border-main-border-default hover:bg-transparent hover:text-text-subtle'
  }`;

  // Alternatives are unavailable with via points — GraphHopper's
  // alternative_route algorithm only supports a start and an end. Only
  // resolved rows count; an empty row does not affect routing.
  const hasResolvedWaypoints = waypointLocations.some((w) => w.coords !== null);

  // "Ikke på kartet" only when none of it can be in view (see Map's
  // routeVisibility); otherwise "ikke helt", which is true either way.
  const routeNote =
    routeVisibility === 'none'
      ? 'Ruten vises ikke på kartet.'
      : routeVisibility === 'partial'
        ? 'Ruten vises ikke helt på kartet.'
        : '';

  // The answer half of the route panel: the summary first, then what can be
  // done with it — the alternatives toggle (a refinement of a result, so it
  // exists only once a route does), the list it produces, and the steps.
  const routeResults = routeSummary ? (
    <div className="space-y-4 text-sm text-text-default">
      {routingStatus === 'error' && (
        // The banner above already names its travel mode; this marks the
        // numbers themselves as the previous answer, not the pressed one's.
        <p className="text-xs text-text-subtle">Forrige rute</p>
      )}
      <div>
        <div
          ref={summaryRef}
          // The answer takes focus when a retry produces one (see above), so it
          // is a focus target, never a tab stop.
          tabIndex={-1}
          className="grid scroll-mb-8 grid-cols-2 gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
        >
          <div>
            <div className="text-xs text-text-subtle">Avstand</div>
            <div className="text-lg font-medium tabular-nums text-text-default">
              {formatDistance(routeSummary.distance)}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-subtle">Reisetid</div>
            <div className="text-lg font-medium tabular-nums text-text-default">
              {formatTimeMinutes(routeSummary.time)}
            </div>
          </div>
        </div>
        {/* The numbers without the route are half an answer. A route is framed
            when it arrives, but the view can be taken elsewhere afterwards —
            by the user, or by "Vis alle treff" framing an area answer — and
            the only way back was the bar that stands in for a summary scrolled
            out of the panel, which a summary in view never shows (polish,
            critique run 16). This says so under the numbers, in the words the
            hits' note uses, and brings it back. Mounted empty so the sentence
            arriving in it is read; empty, it takes no room. */}
        <p className={`text-xs text-text-subtle ${routeNote ? 'mt-2' : ''}`}>
          <span role="status">{routeNote}</span>
          {routeNote && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => {
                  onShowRoute?.();
                  // The action goes once the route is back in view, so focus
                  // moves on to the numbers now rather than to the page.
                  summaryRef.current?.focus({ preventScroll: true });
                }}
                className="rounded font-medium text-text-default underline transition hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
              >
                Vis ruten
              </button>
            </>
          )}
        </p>
      </div>

      {/* What GraphHopper says about the route beyond its numbers, when it has
          anything: under the answer, above the choice of alternatives. It
          describes the selected route; a failed recalculation keeps it on the
          route still drawn. */}
      {activeRoute && onRouteHighlightChange && (
        <RouteDetails route={activeRoute} highlight={routeHighlight} onHighlightChange={onRouteHighlightChange} />
      )}

      {navigationMode && (
        <label
          className={`flex items-start gap-2 font-normal ${
            hasResolvedWaypoints ? 'cursor-not-allowed' : 'cursor-pointer'
          }`}
          title={
            hasResolvedWaypoints
              ? 'Alternative ruter er ikke tilgjengelig med viapunkter'
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={alternativesEnabled && !hasResolvedWaypoints}
            disabled={hasResolvedWaypoints}
            onChange={(e) => onToggleAlternatives(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded-sm accent-base-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default disabled:cursor-not-allowed"
            aria-label="Vis alternative ruter"
          />
          <span className="flex flex-col">
            <span className={hasResolvedWaypoints ? 'text-text-subtle' : 'text-text-default'}>Vis alternative ruter</span>
            {hasResolvedWaypoints && (
              <span className="text-xs text-text-subtle">Ikke tilgjengelig med viapunkter</span>
            )}
          </span>
        </label>
      )}

      {/* Alternative route list — shown when more than one route returned
          and no via point is in play (alternatives are off with via points). */}
      {routes && routes.length > 1 && !hasResolvedWaypoints && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text-default" id="sidebar-routes-heading">Ruter</h3>
          {/* Keyboard-operable list: each route is a real <button>, so
              Tab focuses it and Enter/Space selects (native). aria-pressed
              + aria-current expose the active route to assistive tech so
              users never need to click the map polyline. */}
          <ul className="m-0 list-none space-y-2 p-0" aria-labelledby="sidebar-routes-heading">
            {routes.map((route, idx) => {
              const isActive = route.routeIndex === selectedRouteIndex;
              const label = `Rute ${idx + 1}`;
              return (
                <li key={route.routeIndex}>
                  <button
                    type="button"
                    onClick={() => onSelectRoute(route.routeIndex)}
                    aria-pressed={isActive}
                    aria-current={isActive ? 'true' : undefined}
                    // The chosen route is filled like the pressed Reisemiddel
                    // segment above it: the same state, said the same way. Its
                    // tint alone measured 1.18:1 in light and, in dark, its
                    // border was the WEAKER outline of the list (2.66:1 against
                    // the others' 5.47:1; critique run 12). The focus ring
                    // stands 2px off, so it still reads on a filled row.
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default ${
                      isActive
                        ? 'border-main-base-default bg-main-base-default text-main-base-contrast-default'
                        : 'border-[color:var(--field-border)] text-text-default hover:bg-surface-hover'
                    }`}
                  >
                    <span className="font-medium">{label}</span>
                    <span
                      className={`whitespace-nowrap text-xs tabular-nums ${
                        isActive ? 'text-main-base-contrast-default' : 'text-text-subtle'
                      }`}
                    >
                      {formatDistance(route.distance)} / {formatTimeMinutes(route.time)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {routeSummary.instructions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text-default">Trinn for trinn</h3>
          {/* Hairline-divided rows, no box: the list scrolls inside itself so
              the summary above stays in view on a long route. */}
          <ol className="-mx-2 my-0 max-h-72 list-none divide-y divide-border-subtle overflow-y-auto border-y border-border-subtle p-0">
            {routeSummary.instructions.map((instruction: RouteInstruction, index: number) => (
              <li key={`${instruction.text}-${index}`}>
                <button
                  type="button"
                  className="group flex w-full items-start gap-3 px-2 py-2.5 text-left text-sm transition hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default"
                  onClick={() => handleStepClick(instruction)}
                >
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-main-surface-tinted text-xs font-medium tabular-nums text-main-text-default transition group-hover:bg-surface-default group-focus-visible:bg-surface-default">
                    {index + 1}
                  </span>
                  <span className="flex-1">
                    <span className="block text-text-default">{instruction.text}</span>
                    <span className="mt-1 block text-xs tabular-nums text-text-subtle">
                      {formatDistance(instruction.distance)}
                      {instruction.distance && instruction.time ? ' · ' : ''}
                      {formatTimeMinutes(instruction.time)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  ) : null;

  // The condensed bar stands in for the panel whose header sits highest.
  const panelTitle = feature ? (placeTitle?.title ?? 'Detaljer') : 'Veibeskrivelse';
  const panelClose = feature ? onClose : navigationMode ? onCloseNavigation : onClose;
  const panelCloseLabel = feature ? 'Lukk detaljer' : 'Lukk veibeskrivelse';

  return (
    <aside
      ref={asideRef}
      className="relative min-h-0 w-80 min-w-[260px] max-w-xs flex-1 overflow-y-auto rounded-lg border border-border-default bg-surface-default shadow-lg"
      // Whatever is scrolled up into view (a failure, a control reached with
      // Shift+Tab) lands below the condensed bar, not under it.
      style={{ scrollPaddingTop: PANEL_BAR_HEIGHT }}
    >
      <p role="status" className="sr-only">{announcement}</p>
      {!headerInView && (
        // The panel's own header has scrolled away: its name and its exit stay.
        <div data-panel-bar="" className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border-default bg-surface-default px-6 py-2.5">
          <span className="truncate text-sm font-medium text-text-default">{panelTitle}</span>
          <button
            type="button"
            onClick={panelClose}
            className={`shrink-0 ${closeButtonClass}`}
            aria-label={panelCloseLabel}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      {!navigationMode && !feature && (
        // Only the legacy route summary (a route without its panel) has no
        // header of its own to hold the close button.
        <button
          type="button"
          data-panel-header=""
          onClick={onClose}
          className={`absolute right-2 top-2 ${closeButtonClass}`}
          aria-label="Lukk veibeskrivelse"
        >
          <CloseIcon />
        </button>
      )}

      <div ref={contentRef} className={`px-6 pt-6 ${compact ? 'pb-4' : 'pb-6'}`}>
        {/* Feature details */}
        {feature && (
          // While a route is being planned the place card sits above the
          // route panel, divided by a hairline; its buttons set a stop.
          <section
            aria-label="Detaljer"
            className={`text-sm text-text-default ${compact ? 'space-y-3' : 'space-y-4'} ${
              navigationMode ? 'mb-6 border-b border-border-subtle pb-6' : ''
            }`}
          >
            {/* The place is the headline: it is the answer to the question.
                What it is and where follow on one line; the card is the region
                "Detaljer" for assistive technology. */}
            <div data-panel-header="" className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2
                  ref={headingRef}
                  tabIndex={-1}
                  title={titleClamped ? placeTitle?.title : undefined}
                  className={`break-words text-lg font-medium text-text-default focus:outline-none ${
                    titleClamped ? (compact ? 'line-clamp-2' : 'line-clamp-3') : 'text-balance'
                  }`}
                >
                  {placeTitle?.title}
                </h2>
                {/* Under the name: what it is and where — and, while the card
                    shares the rail with its list, the way back to the facts it
                    folded, sharing this line rather than costing another. */}
                {(titleIsCoordinates || placeMeta || (compact && hasFacts)) && (
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
                    {titleIsCoordinates ? (
                      <CopyButton
                        text={placeTitle?.title ?? ''}
                        icon={false}
                        selectRef={headingRef}
                        className="rounded text-xs font-medium text-text-subtle underline transition hover:text-text-default hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                      />
                    ) : (
                      placeMeta && <p className="text-sm text-text-subtle">{placeMeta}</p>
                    )}
                    {compact && hasFacts && (
                      <button
                        type="button"
                        onClick={() => setFactsOpen((open) => !open)}
                        aria-expanded={factsOpen}
                        className="rounded text-xs font-medium text-text-subtle underline transition hover:text-text-default hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                      >
                        {factsOpen ? 'Skjul detaljer' : 'Vis detaljer'}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
              {onToggleSaved && (
                <button
                  type="button"
                  onClick={onToggleSaved}
                  data-saved-toggle=""
                  aria-pressed={isSaved}
                  aria-label={isSaved ? 'Fjern fra Mine steder' : 'Lagre i Mine steder'}
                  title={isSaved ? 'Fjern fra Mine steder' : 'Lagre i Mine steder'}
                  className={`shrink-0 rounded-full p-1.5 transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default ${
                    isSaved ? 'text-warning-text-default' : 'text-text-subtle'
                  }`}
                >
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill={isSaved ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className={closeButtonClass}
                aria-label="Lukk detaljer"
              >
                <CloseIcon />
              </button>
              </div>
            </div>
            {featureNote && (
              // What happened, and the way to ask again — never a sentence that
              // tells the user to retry with nothing to press.
              <div className="space-y-1">
                <p className="text-sm text-text-subtle">{featureNote}</p>
                {onRetryFeature && (
                  <button
                    type="button"
                    onClick={onRetryFeature}
                    className="rounded text-xs font-medium text-text-subtle underline transition hover:text-text-default hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                  >
                    Prøv igjen
                  </button>
                )}
              </div>
            )}

            {/* Directions right under the name, on one row: the next step stays
                in view however little room the rail leaves the card. Each
                button's name carries the whole action; the Label says what
                they are. */}
            <div>
              <p className="mb-1.5 text-xs text-text-subtle">Veibeskrivelse</p>
              <div role="group" aria-label="Veibeskrivelse" className="flex gap-2">
                <button
                  type="button"
                  className={`${navigateButtonClass} flex-1`}
                  disabled={!canNavigate}
                  aria-label="Veibeskrivelse herfra"
                  onClick={() => {
                    if (featureCenter) {
                      onNavigateFrom(featureCenter);
                      onStartNavigation();
                    }
                  }}
                >
                  Herfra
                </button>
                {navigationMode && onAddWaypoint && (
                  <button
                    type="button"
                    className={`${navigateButtonClass} flex-1`}
                    disabled={!canNavigate}
                    aria-label="Viapunkt her"
                    onClick={() => {
                      if (featureCenter) onAddWaypoint(featureCenter);
                    }}
                  >
                    Via
                  </button>
                )}
                <button
                  type="button"
                  className={`${navigateButtonClass} flex-1`}
                  disabled={!canNavigate}
                  aria-label="Veibeskrivelse hit"
                  onClick={() => {
                    if (featureCenter) {
                      onNavigateTo(featureCenter);
                      onStartNavigation();
                    }
                  }}
                >
                  Hit
                </button>
              </div>
            </div>

            {factsVisible && factRows.length > 0 && (
              <dl ref={factsRef} className="space-y-2">
                {factRows.map((row) => (
                  <div key={row.label}>
                    {/* A fact is a subtle Label over its value in ink, as in the
                        route summary and the measurement readout. */}
                    <dt className="text-xs font-medium text-text-subtle">{row.label}</dt>
                    {row.copyable ? (
                      <dd className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-sm">
                        <CopyableValue value={row.value} />
                      </dd>
                    ) : (
                      <dd className="text-sm">{row.value}</dd>
                    )}
                  </div>
                ))}
              </dl>
            )}

            {factsVisible && extraTags.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer rounded font-medium text-text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default">
                  Flere detaljer
                </summary>
                {knownTags.length > 0 && (
                  <dl className="mt-2 space-y-2">
                    {knownTags.map((tag) => (
                      <div key={tag.key}>
                        <dt className="font-medium text-text-subtle">{tag.label}</dt>
                        <dd className="break-words">{tag.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {rawTags.length > 0 && (
                  <>
                    {/* Tags with no Norwegian name, shown as the data they are. */}
                    <p className="mt-3 font-medium text-text-subtle">Andre OSM-merker</p>
                    <ul className="mt-1 space-y-1">
                      {rawTags.map((tag) => (
                        <li key={tag.key} className="break-all">
                          {tag.label} = {tag.value}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </details>
            )}
          </section>
        )}

        {/* Navigation Panel */}
        {navigationMode && (
          <>
            <NavigationPanel
              fromLocation={fromLocation}
              toLocation={toLocation}
              waypoints={waypointLocations}
              routingProfile={routingProfile}
              onFromChange={onFromChange}
              onToChange={onToChange}
              onWaypointsChange={onWaypointsChange}
              onProfileChange={onProfileChange}
              onSwapLocations={onSwapLocations}
              onClose={onCloseNavigation}
              focusStop={focusStop}
            />

            {(routingStatus !== 'idle' || avoidAreasCount > 0 || routeResults) && (
              <div className="mt-4 space-y-4 border-t border-border-subtle pt-4 text-sm text-text-default">
                {/* Routing loading / empty / error state */}
                {routingStatus === 'loading' && (
                  <div
                    className="flex items-center gap-2 rounded-lg bg-surface-tinted px-3 py-2 text-sm text-text-default"
                    aria-live="polite"
                  >
                    <Spinner data-size="sm" aria-hidden="true" />
                    <span>{ROUTING_STATUS_MESSAGES.loading}</span>
                  </div>
                )}
                {routingStatus === 'empty' && (
                  <div
                    ref={alertRef}
                    className="scroll-mb-8 rounded-lg bg-warning-surface-tinted px-3 py-2 text-sm text-warning-text-default"
                    role="status"
                  >
                    {ROUTING_STATUS_MESSAGES.empty}
                  </div>
                )}
                {routingStatus === 'error' && (
                  <div
                    ref={alertRef}
                    className="flex scroll-mb-8 items-start justify-between gap-3 rounded-lg bg-danger-surface-tinted px-3 py-2 text-sm text-danger-text-default"
                    role="alert"
                  >
                    <span>
                      {routingErrorMessage || ROUTING_STATUS_MESSAGES.error}
                      {/* A failed recalculation keeps the last route below, named
                          by its own travel mode when that is not the pressed one. */}
                      {routeSummary ? (staleRoute ? ` Viser forrige rute (${staleRoute}).` : ' Viser forrige rute.') : ''}
                    </span>
                    {onRetryRoute && (
                      <button
                        type="button"
                        onClick={() => {
                          retryFocusRef.current = true;
                          onRetryRoute();
                        }}
                        className="shrink-0 rounded text-xs font-medium text-danger-text-default underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                      >
                        Prøv igjen
                      </button>
                    )}
                  </div>
                )}

                {/* Avoid-areas status. Areas are drawn on the map with the
                    mouse or the keyboard (Space / Enter / Backspace while the
                    map has focus); "Fjern" here removes them all, undoably. */}
                {avoidAreasCount > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-danger-surface-tinted px-3 py-2 text-sm">
                    <span className="text-danger-text-default">
                      {avoidAreasCount === 1
                        ? '1 område unngås'
                        : `${avoidAreasCount} områder unngås`}
                    </span>
                    <button
                      type="button"
                      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                        // "Fjern" goes with the line it clears, so focus moves
                        // on to what follows it in the panel rather than
                        // falling on the page (critique run 14); when nothing
                        // does, as when the areas left no route to show, back
                        // to what precedes it.
                        const stops = asideRef.current ? getFocusable(asideRef.current) : [];
                        const at = stops.indexOf(event.currentTarget);
                        const next = stops[at + 1] ?? stops[at - 1] ?? null;
                        onClearAvoidAreas();
                        if (!next || typeof requestAnimationFrame === 'undefined') return;
                        requestAnimationFrame(() => {
                          const active = document.activeElement;
                          if (next.isConnected && (!active || active === document.body)) next.focus();
                        });
                      }}
                      data-avoid-clear=""
                      className="rounded text-xs font-medium text-danger-text-default underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                    >
                      Fjern
                    </button>
                  </div>
                )}

                {/* Cleared areas wait in the line's own place, between the
                    failure banner above and the answer below. */}
                <UndoNotice subject="avoid-areas" />

                {routeResults}
              </div>
            )}
          </>
        )}

        {/* A route without its panel (restored from the URL hash, or once the
            details card closed over it): the same answer, no question half.
            Right padding keeps "Reisetid" clear of the absolute close button. */}
        {!navigationMode && !feature && routeResults && (
          <div className="pr-8">{routeResults}</div>
        )}
      </div>

      {moreBelow && !(navigationMode && routeSummary && !summaryInView && routingStatus !== 'error') && (
        // More of the panel lies below. The 1px hairline this replaced was
        // below the perceptual floor (critique run 7): the signal is now a
        // short fade into the card's own white, still sticky and zero-height
        // so it takes no room of its own.
        <div aria-hidden="true" data-scroll-edge="" className="pointer-events-none sticky bottom-0 h-0">
          <div
            // The band never reaches solid. Height was not the problem: at
            // full opacity its last quarter ERASED the line beneath it, which
            // reads as a disabled row rather than a cut one (measured at 73%
            // of "Rullestol", critique run 10). Capped at 80% it dims toward
            // the edge instead, and the container edge does the cutting —
            // honest, because the line really is cut off there.
            className="absolute inset-x-0 bottom-0 h-6"
            style={{
              background:
                'linear-gradient(to top, color-mix(in srgb, var(--mtds-color-surface-default) 80%, transparent) 0%, color-mix(in srgb, var(--mtds-color-surface-default) 45%, transparent) 55%, transparent)'
            }}
          />
        </div>
      )}
      {navigationMode && routeSummary && !summaryInView && routingStatus !== 'error' && (
        <button
          type="button"
          // Both halves of what the label says: the numbers back into the
          // panel, and the route back onto the map (critique run 16).
          onClick={() => {
            summaryRef.current?.scrollIntoView({ block: 'center' });
            onShowRoute?.();
          }}
          className="sticky bottom-0 flex w-full items-center justify-between gap-3 border-t border-border-default bg-surface-default px-6 py-3 text-left text-sm transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default"
        >
          <span className="whitespace-nowrap tabular-nums text-text-default">
            <span className="font-medium">{formatDistance(routeSummary.distance)}</span>
            {' · '}
            {formatTimeMinutes(routeSummary.time)}
          </span>
          <span className="text-xs font-medium text-text-subtle underline">Vis ruten</span>
        </button>
      )}
    </aside>
  );
};

export default SideBar;
