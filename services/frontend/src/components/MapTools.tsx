import React, { useEffect, useRef, useState } from 'react';
import CopyButton from './CopyButton';
import { formatMeasuredArea, formatMeasuredDistance } from '../lib/format';

/**
 * The map's own instruments, bottom-right: a 40px "Verktøy" control that
 * opens a card of named tool rows, above a zoom pair. At rest the default
 * screen shows only the two everyday jobs in the rail and these two small
 * controls; the specialist tools are one press away, never louder than the
 * map (decided 2026-09-14).
 *
 * Rows appear only when they can do something: "Unngå område" while a route
 * is being planned (avoid areas only affect routing), "Gatebilde" when a
 * street-view source is configured. The drawing itself still happens on the
 * map; the rows only arm and disarm the tools.
 *
 * A finished measurement adds a readout on top of the stack, next to the
 * tool that produced it: the value, "Kopier" for a case file, and "Fjern
 * målingen", which also clears the line and its popup from the map.
 *
 * Active colours follow the semantic hues: Survey Blue for measuring and the
 * street-view layer (selection / measurement), Rust Red for avoid areas. An
 * armed tool also tints the control itself, so the state stays visible while
 * the card is closed.
 */

export type MeasureMode = 'none' | 'distance' | 'area';

interface MapToolsProps {
  measureMode: MeasureMode;
  onMeasureModeChange: (mode: MeasureMode) => void;
  /** Shown only while a route is being planned. */
  showAvoidTool: boolean;
  avoidDrawing: boolean;
  onAvoidDrawingChange: (active: boolean) => void;
  /** Whether a street-view source is configured for this deployment. */
  streetViewAvailable: boolean;
  streetViewVisible: boolean;
  onToggleStreetView: () => void;
  /** Why the street-view layer shows nothing, while it is on. */
  streetViewHint?: string | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** The last finished measurement, shown in a readout until removed. */
  measurement?: { type: 'distance' | 'area'; value: number } | null;
  /** Remove the finished measurement: readout, line and popup. */
  onClearMeasurement?: () => void;
}

const iconProps = {
  className: 'h-5 w-5 shrink-0',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
};

const ToolsIcon = () => (
  <svg {...iconProps}>
    <path d="M14.7 6.3a4.5 4.5 0 0 0 5.9 5.9l-2.9 2.9-4.2-4.2 2.9-2.9z" />
    <path d="M11.5 12.5 4.6 19.4a1.5 1.5 0 0 0 2.1 2.1l6.9-6.9" />
    <path d="M3 3l4.5 4.5M8 6.5 6.5 8" />
  </svg>
);

const DistanceIcon = () => (
  <svg {...iconProps}>
    <path d="M3 8.5 8.5 3 21 15.5 15.5 21z" />
    <path d="m7 9 1.5 1.5M9.5 6.5 11 8M12 9l1.5 1.5M14.5 6.5 16 8" />
  </svg>
);

const AreaIcon = () => (
  <svg {...iconProps}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
  </svg>
);

const AvoidIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </svg>
);

const StreetViewIcon = () => (
  <svg {...iconProps}>
    <path d="M2.25 12s3.75-6 9.75-6 9.75 6 9.75 6-3.75 6-9.75 6-9.75-6-9.75-6z" />
    <circle cx="12" cy="12" r="2.25" />
  </svg>
);

const PlusIcon = () => (
  <svg {...iconProps}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const MinusIcon = () => (
  <svg {...iconProps}>
    <path d="M5 12h14" />
  </svg>
);

const CloseIcon = () => (
  <svg {...iconProps}>
    <path d="M6 18L18 6M6 6l12 12" />
  </svg>
);

type ActiveTone = 'info' | 'danger';

interface ToolRowProps {
  label: string;
  icon: React.ReactNode;
  pressed: boolean;
  tone: ActiveTone;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** A line under the row saying why the tool shows nothing. */
  hint?: string | null;
}

const activeClass: Record<ActiveTone, string> = {
  info: 'bg-info-base-default text-info-base-contrast-default hover:bg-info-base-hover',
  danger: 'bg-danger-base-default text-danger-base-contrast-default hover:bg-danger-base-hover'
};

/** One tool: a full-width toggle row with icon, label and pressed state. */
const ToolRow: React.FC<ToolRowProps> = ({ label, icon, pressed, tone, onClick, buttonRef, hint }) => {
  const hintId = React.useId();
  return (
  <li>
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-describedby={hint ? hintId : undefined}
      className={`flex h-10 w-full items-center gap-2.5 px-3 text-left text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default ${
        pressed ? activeClass[tone] : 'text-text-default hover:bg-surface-hover'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
    {hint && (
      <p id={hintId} className="px-3 pb-2 pl-[2.625rem] pt-1 text-xs text-text-subtle">
        {hint}
      </p>
    )}
  </li>
  );
};

/**
 * Focus on a standalone control over the map: the ring stands 2px off the
 * border with the control's own surface in the gap, so it reads as a ring and
 * never as a heavier border.
 */
const outerFocus =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default';

/** The 40px map controls (the Verktøy toggle, the zoom pair) share one look. */
const controlClass = `flex h-10 w-10 items-center justify-center transition ${outerFocus}`;

const MapTools: React.FC<MapToolsProps> = ({
  measureMode,
  onMeasureModeChange,
  showAvoidTool,
  avoidDrawing,
  onAvoidDrawingChange,
  streetViewAvailable,
  streetViewVisible,
  onToggleStreetView,
  streetViewHint = null,
  onZoomIn,
  onZoomOut,
  measurement = null,
  onClearMeasurement
}: MapToolsProps) => {
  const [open, setOpen] = useState(false);
  const panelId = React.useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstRowRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const readoutValueRef = useRef<HTMLParagraphElement>(null);

  // Arming a tool puts the card away: the banner and the tinted control carry
  // the state from here, and the work happens on the map.
  const toggleMeasure = (mode: Exclude<MeasureMode, 'none'>) => {
    const next = measureMode === mode ? 'none' : mode;
    onMeasureModeChange(next);
    if (next !== 'none') setOpen(false);
  };

  // Opening hands focus to the first row so a keyboard user lands inside the
  // card; a mouse user sees no ring (pointer focus is not :focus-visible).
  useEffect(() => {
    if (!open) return;
    firstRowRef.current?.focus({ preventScroll: true });
    // While the street-view panel is open the group above is capped and
    // scrolls, and there is less room than a full card needs. Bring the card
    // itself to the top of that group — `nearest` only grazes its first row
    // into view past the measurement readout above it, which left focus on a
    // row nobody could see (measured, critique run 9).
    cardRef.current?.scrollIntoView?.({ block: 'start' });
  }, [open]);

  // The cap engages when the street-view panel opens, which RESIZES this group
  // under a card that is already open. The effect above fires only on an open
  // transition, so that card stayed at scrollTop 0 with the readout filling
  // the 128px window and "Gatebilde" — the tool that opened the panel — off
  // screen (critique run 10). A resize is the signal; it cannot fight normal
  // scrolling, which changes no size.
  //
  // What to bring into view: the row the user is on, if focus is in the card;
  // otherwise the row that is on. The card is taller than the window, and
  // aligning its top cut off its last row — the pressed "Gatebilde", whose
  // hint explains the panorama now open, at 40% (critique run 11).
  useEffect(() => {
    const group = scrollRef.current;
    if (!open || !group || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const card = cardRef.current;
      if (!card) return;
      const active = document.activeElement;
      const focusedRow = active && card.contains(active) ? active.closest('li') : null;
      const pressedRow = card.querySelector('[aria-pressed="true"]')?.closest('li');
      const row = focusedRow ?? pressedRow;
      if (row) row.scrollIntoView?.({ block: 'nearest' });
      else card.scrollIntoView?.({ block: 'start' });
    });
    observer.observe(group);
    return () => observer.disconnect();
  }, [open]);

  const armedTool =
    avoidDrawing
      ? 'Unngå område'
      : measureMode === 'distance'
        ? 'Mål avstand'
        : measureMode === 'area'
          ? 'Mål areal'
          : null;
  const armedTone: ActiveTone = avoidDrawing ? 'danger' : 'info';

  const readoutLabel = measurement?.type === 'area' ? 'Areal' : 'Avstand';
  const readoutValue = measurement
    ? measurement.type === 'area'
      ? formatMeasuredArea(measurement.value)
      : formatMeasuredDistance(measurement.value)
    : '';

  const closeFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    toggleRef.current?.focus({ preventScroll: true });
  };

  return (
    // `map-tools-stack` lets app.css lift the whole stack above the
    // street-view panel, like Leaflet's own bottom controls.
    <div className="map-tools-stack pointer-events-none absolute bottom-10 right-4 z-controls flex flex-col items-end gap-2">
      {/* Always mounted, so a change is announced when it happens. */}
      <p role="status" className="sr-only">
        {streetViewVisible ? (streetViewHint ?? '') : ''}
      </p>
      <p role="status" className="sr-only">
        {measurement ? `${readoutLabel}: ${readoutValue}` : ''}
      </p>

      {/* The variable part of the stack. While the street-view panel is open
          the stack is lifted 50vh and this group is capped and scrolls
          (app.css), so a full tools card plus a measurement readout can never
          reach the top-right cluster; the Verktøy toggle and the zoom pair
          stay pinned below it and always reachable (critique run 9). Its
          children keep their own height (`shrink-0`): a capped flex column
          would otherwise squash them to fit instead of scrolling. */}
      <div ref={scrollRef} className="map-tools-scroll pointer-events-none flex flex-col items-end gap-2">
        {measurement && (
          <section
            aria-label="Måling"
            className="pointer-events-auto w-52 shrink-0 rounded-lg border border-border-default bg-surface-default shadow-sm"
          >
            <div className="flex items-start justify-between gap-2 pl-3 pr-1.5 pt-2">
              <div className="min-w-0">
                <p className="text-xs text-text-subtle">{readoutLabel}</p>
                <p ref={readoutValueRef} className="select-all text-lg font-medium tabular-nums text-text-default">{readoutValue}</p>
              </div>
              <button
                type="button"
                onClick={onClearMeasurement}
                aria-label="Fjern målingen"
                title="Fjern målingen"
                className="rounded-full p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="mt-1 border-t border-border-subtle">
              <CopyButton
                text={`${readoutLabel}: ${readoutValue}`}
                selectRef={readoutValueRef}
                className="flex h-10 w-full items-center gap-2.5 rounded-b-[9px] px-3 text-left text-sm font-medium text-text-default transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-default"
              />
            </div>
          </section>
        )}

        {open && (
          <div
            ref={cardRef}
            id={panelId}
            role="group"
            aria-label="Verktøy"
            onKeyDown={closeFromKeyboard}
            className="pointer-events-auto w-52 shrink-0 overflow-hidden rounded-lg border border-border-default bg-surface-default shadow-sm"
          >
            <ul className="divide-y divide-border-subtle">
              <ToolRow
                label="Mål avstand"
                icon={<DistanceIcon />}
                pressed={measureMode === 'distance'}
                tone="info"
                onClick={() => toggleMeasure('distance')}
                buttonRef={firstRowRef}
              />
              <ToolRow
                label="Mål areal"
                icon={<AreaIcon />}
                pressed={measureMode === 'area'}
                tone="info"
                onClick={() => toggleMeasure('area')}
              />
              {showAvoidTool && (
                <ToolRow
                  label="Unngå område"
                  icon={<AvoidIcon />}
                  pressed={avoidDrawing}
                  tone="danger"
                  onClick={() => {
                    const next = !avoidDrawing;
                    onAvoidDrawingChange(next);
                    if (next) setOpen(false);
                  }}
                />
              )}
              {streetViewAvailable && (
                <ToolRow
                  label="Gatebilde"
                  icon={<StreetViewIcon />}
                  pressed={streetViewVisible}
                  tone="info"
                  onClick={onToggleStreetView}
                  hint={streetViewVisible ? streetViewHint : null}
                />
              )}
            </ul>
          </div>
        )}
      </div>

      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={armedTool ? `Verktøy (${armedTool} er på)` : 'Verktøy'}
        title="Verktøy"
        className={`pointer-events-auto rounded-lg border border-border-default shadow-sm ${controlClass} ${
          armedTool
            ? activeClass[armedTone]
            : 'bg-surface-default text-text-subtle hover:bg-surface-hover hover:text-text-default'
        }`}
      >
        <ToolsIcon />
      </button>

      {/* No overflow clip: the focus ring of a zoom button stands outside it. */}
      <div
        role="group"
        aria-label="Zoom"
        className="pointer-events-auto flex flex-col divide-y divide-border-subtle rounded-lg border border-border-default bg-surface-default shadow-sm"
      >
        <button
          type="button"
          onClick={onZoomIn}
          className={`${controlClass} relative rounded-t-[9px] text-text-subtle hover:bg-surface-hover hover:text-text-default focus-visible:z-10`}
          aria-label="Zoom inn"
          title="Zoom inn"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          className={`${controlClass} relative rounded-b-[9px] text-text-subtle hover:bg-surface-hover hover:text-text-default focus-visible:z-10`}
          aria-label="Zoom ut"
          title="Zoom ut"
        >
          <MinusIcon />
        </button>
      </div>
    </div>
  );
};

export default MapTools;
