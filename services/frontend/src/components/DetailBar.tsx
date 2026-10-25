import React from 'react';
import type { DetailShare } from '../lib/routeDetails';
import { UNKNOWN_LABEL } from '../lib/routeDetailLabels';

interface DetailBarProps {
  title: string;
  shares: DetailShare[];
  /** The category of this bar lit on the map now (preview or pinned), or null. */
  activeId: string | null;
  /** The category of this bar pinned, or null. */
  pinnedId: string | null;
  /** Hover/focus → id; leave/blur → null. */
  onPreview: (id: string | null) => void;
  /** Press → pin, or unpin when already pinned. */
  onTogglePin: (id: string) => void;
}

/**
 * Ramp by rank among known shares: the largest known share gets the
 * strongest tone (ramp-1) — darkest in light, lightest in dark, since the
 * ramp is mixed from the base colour and flips with it; missing data is
 * hatched instead, never a tone. The rank counts only non-Ukjent shares, so
 * the first known share gets ramp-1, capped at ramp-4.
 */
const getShareFill = (share: DetailShare, shares: DetailShare[]): string => {
  if (share.id === UNKNOWN_LABEL) return 'var(--detail-unknown)';

  // Count how many known (non-Ukjent) shares come before this one
  let knownRank = 0;
  for (const s of shares) {
    if (s.id === share.id) break;
    if (s.id !== UNKNOWN_LABEL) knownRank++;
  }

  return `var(--detail-ramp-${Math.min(knownRank + 1, 4)})`;
};

/**
 * One detail of the route as a proportional bar and a legend in share order.
 * The legend items are buttons: hover or focus lights the category's stretches
 * on the map, a press pins them there. The bar is decorative (aria-hidden):
 * the legend carries every name and share.
 */
const DetailBar: React.FC<DetailBarProps> = ({ title, shares, activeId, pinnedId, onPreview, onTogglePin }) => {
  const titleId = React.useId();
  if (shares.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="border-t border-border-subtle pt-3">
      <h3 id={titleId} className="text-sm font-medium text-text-default">
        {title}
      </h3>
      <div aria-hidden="true" className="my-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {shares.map((share) => (
          <span
            key={share.id}
            style={{ flexGrow: share.metres, flexBasis: 0, background: getShareFill(share, shares) }}
            className={activeId !== null && activeId !== share.id ? 'opacity-40' : ''}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
        {shares.map((share) => {
          const pinned = pinnedId === share.id;
          return (
            <li key={share.id}>
              <button
                type="button"
                aria-pressed={pinned}
                onMouseEnter={() => onPreview(share.id)}
                onMouseLeave={() => onPreview(null)}
                onFocus={() => onPreview(share.id)}
                onBlur={() => onPreview(null)}
                onClick={() => onTogglePin(share.id)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1 py-0.5 text-text-default transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default ${
                  pinned ? 'bg-surface-tinted font-medium' : ''
                }`}
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: getShareFill(share, shares) }} />
                {share.label} {share.share} %
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default DetailBar;
