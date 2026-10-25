import React, { useMemo, useState } from 'react';
import type { RouteResult } from '../lib/graphhopper';
import { crossingPhrase, DETAIL_TITLES, type ShareKey } from '../lib/routeDetailLabels';
import { crossings, detailShares, elevationProfile, type RouteHighlight } from '../lib/routeDetails';
import DetailBar from './DetailBar';
import ElevationProfile from './ElevationProfile';

interface RouteDetailsProps {
  route: RouteResult;
  highlight: RouteHighlight;
  onHighlightChange: React.Dispatch<React.SetStateAction<RouteHighlight>>;
}

// "Vis veitype og fartsgrenser" stays as the user left it for the session.
const MORE_KEY = 'openmaps.routeDetails.more';
const readMore = (): boolean => {
  try {
    return sessionStorage.getItem(MORE_KEY) === '1';
  } catch {
    return false;
  }
};
const writeMore = (open: boolean) => {
  try {
    sessionStorage.setItem(MORE_KEY, open ? '1' : '0');
  } catch {
    // Storage refused (private window): the fold simply resets next time.
  }
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What GraphHopper says about the route beyond distance and time — only the
 * parts it has data for: the height profile, the surface, the crossings, and
 * (folded, as specialist) road type and speed limits. Renders nothing for a
 * route with none of them, so a GraphHopper without details looks as before.
 */
const RouteDetails: React.FC<RouteDetailsProps> = ({ route, highlight, onHighlightChange }) => {
  const [more, setMore] = useState(readMore);
  const moreId = React.useId();
  const profile = useMemo(() => elevationProfile(route), [route]);
  const surface = useMemo(() => detailShares(route, 'surface'), [route]);
  const roadClass = useMemo(() => detailShares(route, 'road_class'), [route]);
  const maxSpeed = useMemo(() => detailShares(route, 'max_speed'), [route]);
  const crossing = useMemo(() => crossings(route), [route]);

  const hasMore = roadClass.length > 0 || maxSpeed.length > 0;
  if (!profile && surface.length === 0 && !crossing && !hasMore) return null;

  const shown = highlight.preview ?? highlight.pinned;
  const barProps = (key: ShareKey) => ({
    activeId: shown?.key === key ? shown.id : null,
    pinnedId: highlight.pinned?.key === key ? highlight.pinned.id : null,
    onPreview: (id: string | null) =>
      onHighlightChange((prev) => ({ ...prev, preview: id === null ? null : { key, id } })),
    onTogglePin: (id: string) =>
      onHighlightChange((prev) => ({
        ...prev,
        pinned: prev.pinned?.key === key && prev.pinned.id === id ? null : { key, id }
      }))
  });

  const toggleMore = () => {
    const open = !more;
    setMore(open);
    writeMore(open);
    // Folding away a lit road type or speed limit puts its stretches out too.
    if (!open) {
      onHighlightChange((prev) => ({
        ...prev,
        preview: prev.preview && prev.preview.key !== 'surface' ? null : prev.preview,
        pinned: prev.pinned && prev.pinned.key !== 'surface' ? null : prev.pinned
      }));
    }
  };

  return (
    <div className="space-y-3">
      {profile && (
        <ElevationProfile
          profile={profile}
          position={highlight.position}
          onPosition={(metres) => onHighlightChange((prev) => ({ ...prev, position: metres }))}
        />
      )}
      <DetailBar title={DETAIL_TITLES.surface} shares={surface} {...barProps('surface')} />
      {crossing && (
        <p className="border-t border-border-subtle pt-3 text-sm text-text-subtle">
          {capitalise(
            [
              crossingPhrase('bridge', crossing.bridge),
              crossingPhrase('tunnel', crossing.tunnel),
              crossingPhrase('ferry', crossing.ferry)
            ].join(' · ')
          )}
        </p>
      )}
      {hasMore && (
        <div className="border-t border-border-subtle pt-3">
          <button
            type="button"
            aria-expanded={more}
            // Only while open: an IDREF must resolve (critique run 16, K2).
            aria-controls={more ? moreId : undefined}
            onClick={toggleMore}
            className="rounded text-xs font-medium text-text-default underline transition hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
          >
            {more ? 'Skjul veitype og fartsgrenser' : 'Vis veitype og fartsgrenser'}
          </button>
          {more && (
            <div id={moreId} className="mt-1 space-y-3">
              <DetailBar title={DETAIL_TITLES.road_class} shares={roadClass} {...barProps('road_class')} />
              <DetailBar title={DETAIL_TITLES.max_speed} shares={maxSpeed} {...barProps('max_speed')} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RouteDetails;
