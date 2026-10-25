import React from 'react';
import type { GeoJSONFeature } from '../lib/nominatim';
import { getDisplayName, getSubtitle } from '../lib/overpassFeature';
import type { OverpassGenerator } from '../lib/overpass';
import { mapColors } from '../lib/mapColors';
import CopyButton from './CopyButton';
import { useIsClamped } from '../hooks/useIsClamped';

/** A Label line under the header: how the question was read. */
const GENERATOR_LABELS: Record<OverpassGenerator, string> = {
  llm: 'Tolket av språkmodell',
  byt5: 'Tolket av innebygd modell (best på engelsk)',
  keyword: 'Søkt på ordene du skrev'
};

interface OverpassResultsProps {
  /** Current Overpass result features (rendered as a scrollable list). */
  features: GeoJSONFeature[];
  /**
   * Open a hit's details card by its index in `features`; the parent docks the
   * card above this list and lifts the hit's dot on the map.
   */
  onSelectFeature: (index: number) => void;
  /** The hit whose card is open, marked current in the list. */
  selectedIndex?: number | null;
  /**
   * Whether another panel shares the rail with this list — a place card (a
   * hit's, or one asked about on the map) or the route panel. The header then
   * gives up its provenance lines and holds its question to one line, so the
   * rows keep their height. With the full 119px header a one-hit list could
   * not show its one row in the 9rem it is left: 23 of 71px under a card, 24
   * under a computed route (critique run 11). Not derived from `selectedIndex`:
   * a map-click card has no hit index (critique run 10).
   */
  sharesRail: boolean;
  /** Close the panel (and clear the results). */
  onClose: () => void;
  /** Lift the hit's numbered dot on the map while its row is hovered or focused. */
  onHighlightFeature?: (index: number | null) => void;
  /** The question these results answer, restated in the header. */
  query?: string;
  /** The Overpass query that ran, shown on request for whoever wants to check or reuse it. */
  overpassQuery?: string;
  /** Which engine read the question, when the backend says. */
  generator?: OverpassGenerator;
  /** How many hits lie outside the map's current view (see Map). */
  hiddenCount?: number;
  /** Fit the map to every hit again. */
  onShowAll?: () => void;
}

/**
 * Panel listing the current Overpass results, docked in the left rail under
 * the search bar that produced them. Each row is a button that opens that hit's
 * details card; the list stays under the card, so hits can be compared. Rendered only when there are results (App gates
 * on `overpassFeatures.length > 0`); the rail bounds its height, so the list
 * scrolls inside the card, and a header grown taller than the room left (the
 * query unfolded on a short screen) scrolls with it rather than being cut off. Desktop-only; all strings are Norwegian.
 */
const OverpassResults: React.FC<OverpassResultsProps> = ({
  features,
  onSelectFeature,
  selectedIndex = null,
  sharesRail,
  onClose,
  onHighlightFeature,
  query,
  overpassQuery,
  generator,
  hiddenCount = 0,
  onShowAll
}: OverpassResultsProps) => {
  const headingId = React.useId();
  const listRef = React.useRef<HTMLUListElement>(null);
  const headingText = query ? `${features.length} treff for «${query}»` : `${features.length} treff`;
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  // The heading restates a question that is still in the search field above,
  // so it never needs to be whole: two lines at most — a 150-character
  // question once made this header 310px, half the rail (critique run 11) —
  // and one while another panel shares the rail. The same rule as the card's
  // headline: the full question is carried in a tooltip only when the clamp
  // actually hid part of it.
  const headingLines = sharesRail ? 1 : 2;
  const headingClamped = useIsClamped(headingRef, headingLines, headingText);

  // The answer is true only inside the extent it was asked about, and one drag
  // of the map used to leave all fourteen rows standing over an empty map,
  // with nothing saying so and nothing to press (critique run 16). The header
  // now says when hits have left the view and brings them back. It is not
  // provenance: it stays while another panel shares the rail, because a list
  // that disagrees with the map outranks a row.
  //
  // "Kartutsnittet" is the part of the map the question was asked about — the
  // mode, "Søker i kartutsnittet…", "Ingen treff … i kartutsnittet" — and is
  // never the view on screen now: every hit lies inside the searched one, which
  // is how it was found, so "Ingen av treffene er i kartutsnittet" said
  // something false (clarify, run 16). What changed is what the map shows, so
  // the note says that, in the verb its button answers with: vises / Vis.
  const offScreenNote =
    hiddenCount <= 0
      ? ''
      : features.length === 1
        ? 'Treffet vises ikke på kartet.'
        : hiddenCount >= features.length
          ? 'Ingen av treffene vises på kartet.'
          : `${hiddenCount} av ${features.length} treff vises ikke på kartet.`;
  const showAll = () => {
    onShowAll?.();
    // The action goes once the map has brought every hit back, so focus moves
    // on now rather than dropping to the page: to the open hit's row, else the
    // first — the rows are what the user asked to see.
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-overpass-row="${selectedIndex ?? 0}"]`
    );
    row?.focus();
  };

  // A hit picked on the map scrolls its row into view.
  React.useEffect(() => {
    if (selectedIndex === null) return;
    const list = listRef.current;
    const row = () => list?.querySelector<HTMLElement>(`[data-overpass-row="${selectedIndex}"]`);
    row()?.scrollIntoView?.({ block: 'nearest' });
    // The rail can shrink this list underneath us — the card takes the room
    // while its facts are open — and the row scrolled into view before that
    // is not the row left visible after it. Without this the one row the
    // floor preserves was whichever happened to sit at the top, not the hit
    // being read about (measured at 1280x720, critique run 10).
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => row()?.scrollIntoView?.({ block: 'nearest' }));
    observer.observe(list);
    return () => observer.disconnect();
  }, [selectedIndex]);

  return (
    <aside
      aria-labelledby={headingId}
      className="flex min-h-0 w-80 min-w-[260px] max-w-xs flex-col overflow-y-auto rounded-lg border border-border-default bg-surface-default shadow-lg"
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-border-default bg-surface-default px-4 py-3">
        <div className="min-w-0">
          <h2
            id={headingId}
            ref={headingRef}
            title={headingClamped ? headingText : undefined}
            className={`break-words text-lg font-medium text-text-default ${
              headingClamped ? (sharesRail ? 'line-clamp-1' : 'line-clamp-2') : 'text-balance'
            }`}
          >
            {headingText}
          </h2>
          {/* Mounted empty so the sentence arriving in it is read: a live
              region that appears together with its content is not (see
              UndoNotice). Empty, it takes no height. */}
          <p className={`text-xs text-text-subtle ${offScreenNote ? 'mt-1' : ''}`}>
            <span role="status">{offScreenNote}</span>
            {offScreenNote && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={showAll}
                  className="rounded font-medium text-text-default underline transition hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
                >
                  {features.length === 1 ? 'Vis treffet' : 'Vis alle treff'}
                </button>
              </>
            )}
          </p>
          {/* While another panel shares the rail the rows are the scarce
              thing, so the header gives up its provenance lines before the
              list gives up a row. Both come back the moment that panel closes. */}
          {!sharesRail && generator && (
            <p className="text-xs text-text-subtle">{GENERATOR_LABELS[generator]}</p>
          )}
          {!sharesRail && overpassQuery && (
            <details className="mt-1 text-xs text-text-subtle">
              <summary className="cursor-pointer rounded font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default">Vis spørringen</summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-tinted p-2 text-xs text-text-default [font-family:inherit]">
                {overpassQuery}
              </pre>
              <CopyButton
                text={overpassQuery}
                icon={false}
                className="mt-1 rounded text-xs font-medium text-text-subtle underline hover:text-text-default hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
              />
            </details>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
          aria-label="Lukk resultatliste"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <ul ref={listRef} className="min-h-[4.5rem] flex-1 divide-y divide-border-subtle overflow-y-auto" role="list">
        {features.map((feature, index) => {
          const name = getDisplayName(feature);
          const subtitle = getSubtitle(feature);
          const ariaLabel = subtitle ? `${name}, ${subtitle}` : name;
          return (
            <li key={index}>
              <button
                type="button"
                data-overpass-row={index}
                aria-current={index === selectedIndex ? 'true' : undefined}
                onClick={() => onSelectFeature(index)}
                onMouseEnter={() => onHighlightFeature?.(index)}
                onMouseLeave={() => onHighlightFeature?.(null)}
                onFocus={() => onHighlightFeature?.(index)}
                onBlur={() => onHighlightFeature?.(null)}
                aria-label={`Treff ${index + 1}, ${ariaLabel}`}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-surface-hover focus:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default ${
                  index === selectedIndex ? 'bg-main-surface-tinted' : ''
                }`}
              >
                {/* The same number, in the same colour, as the dot on the map;
                    the open hit's numeral is ringed as its dot is. The row's
                    tint alone is 1.18:1 (critique run 12), and a ring round
                    the whole row would read as the focus ring. Ink, not the
                    map's ring colour, so it holds in the dark scheme too. */}
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium tabular-nums ${
                    index === selectedIndex ? 'ring-2 ring-text-default ring-offset-2 ring-offset-main-surface-tinted' : ''
                  }`}
                  style={{ backgroundColor: mapColors.featurePoint, borderColor: mapColors.pointHalo, color: mapColors.pointHalo }}
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="line-clamp-1 text-sm font-medium text-text-default">{name}</span>
                  {subtitle && (
                    <span className="line-clamp-2 text-xs text-text-subtle">{subtitle}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
};

export default OverpassResults;
