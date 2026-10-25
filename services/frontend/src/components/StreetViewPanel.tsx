import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@mattilsynet/design/react';
import 'pannellum/build/pannellum.css';
import type { StreetViewEventDetail } from './Map';
import { formatCaptureDate } from '../lib/formatDate';

/** The panorama viewer's own messages, in bokmål like the rest of the map. */
const PANNELLUM_STRINGS = {
  loadButtonLabel: 'Klikk for å<br>laste<br>bildet',
  loadingLabel: 'Laster …',
  bylineLabel: 'av %s',
  noPanoramaError: 'Ingen gatebilde er valgt.',
  fileAccessError: 'Kunne ikke åpne bildefilen %s.',
  malformedURLError: 'Adressen til bildet er ugyldig.',
  iOS8WebGLError: 'Denne enheten kan ikke vise gatebilder.',
  genericWebGLError: 'Nettleseren kan ikke vise gatebilder fordi den mangler støtte for WebGL.',
  textureSizeError: 'Bildet er for stort for denne enheten. Det er %spx bredt, men enheten støtter bare %spx.',
  unknownError: 'Gatebildet kunne ikke vises.'
};

interface StreetViewSelection extends StreetViewEventDetail {
  panoramaUrl: string | null;
}

interface StreetViewPanelProps {
  selection: StreetViewSelection | null;
  metadata: Record<string, unknown> | null;
  loadingMetadata: boolean;
  error: string | null;
  onClose: () => void;
  /** Called when the panel closes while it holds focus: hand focus back to the map. */
  restoreFocus?: () => void;
}

/** The viewer's own controls, in the product's 40px map-control style. */
const panoControlClass =
  'relative flex h-10 w-10 items-center justify-center text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-base-default';

const panoGlyph = {
  className: 'h-5 w-5',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
};

const getNumericValue = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readValue = (source: Record<string, unknown> | null | undefined, key: string) =>
  source ? source[key] : undefined;

const StreetViewPanel: React.FC<StreetViewPanelProps> = ({
  selection,
  metadata,
  loadingMetadata,
  error,
  onClose,
  restoreFocus
}: StreetViewPanelProps) => {
  const titleId = React.useId();
  // Not modal: the panel covers the lower half while the map above stays
  // usable, so it must not trap focus. Escape still closes it.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };
  // Opening hands focus to "Lukk gatebilde", so Escape and Tab start inside the
  // viewer; closing while it holds focus returns focus to the map.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [selection?.id]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    return () => {
      if (root && root.contains(document.activeElement)) restoreFocus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pannellumInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pannellumModuleRef = useRef<any>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  // Latest yaw/pitch/hfov, read at viewer creation time without re-creating
  // the viewer when they change.
  const viewerOptionsRef = useRef({ yaw: 0, pitch: 0, hfov: 90 });

  const destroyViewer = () => {
    if (pannellumInstanceRef.current?.destroy) {
      pannellumInstanceRef.current.destroy();
    }
    pannellumInstanceRef.current = null;
  };

  // Zoom narrows or widens the field of view; the viewer keeps it within limits.
  const zoomBy = (delta: number) => {
    const viewer = pannellumInstanceRef.current;
    if (!viewer?.setHfov || !viewer.getHfov) return;
    viewer.setHfov(viewer.getHfov() + delta);
  };

  const ensurePannellum = async () => {
    if (pannellumModuleRef.current) return pannellumModuleRef.current;
    await import('pannellum/build/pannellum.js');
    const pannellumGlobal = window.pannellum;
    if (!pannellumGlobal || typeof pannellumGlobal.viewer !== 'function') {
      throw new Error('Gatebildet kunne ikke vises.');
    }
    pannellumModuleRef.current = pannellumGlobal;
    return pannellumGlobal;
  };

  const computeViewerOptions = useMemo(() => {
    if (!selection) return { yaw: 0, pitch: 0, hfov: 90 };
    const yaw =
      getNumericValue(readValue(metadata, 'heading')) ??
      getNumericValue(readValue(metadata, 'yaw')) ??
      getNumericValue(readValue(selection.properties, 'heading')) ??
      getNumericValue(readValue(selection.properties, 'yaw')) ??
      0;
    const pitch =
      getNumericValue(readValue(metadata, 'pitch')) ??
      getNumericValue(readValue(selection.properties, 'pitch')) ??
      0;
    const hfov =
      getNumericValue(readValue(metadata, 'hfov')) ??
      getNumericValue(readValue(selection.properties, 'hfov')) ??
      90;
    return { yaw, pitch, hfov };
  }, [metadata, selection]);

  // Extract and format the image date from metadata or properties
  const imageDate = useMemo(() => {
    if (!selection) return null;
    // Try metadata first, then properties
    const dateValue = 
      readValue(metadata, 'date') ?? 
      readValue(metadata, 'captured_at') ?? 
      readValue(metadata, 'timestamp') ??
      readValue(selection.properties, 'date') ?? 
      readValue(selection.properties, 'captured_at') ?? 
      readValue(selection.properties, 'timestamp');
    return formatCaptureDate(dateValue);
  }, [metadata, selection]);

  useEffect(
    () => () => {
      destroyViewer();
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const renderViewer = async () => {
      if (typeof window === 'undefined') return;
      if (!selection) {
        destroyViewer();
        setViewerError(null);
        return;
      }
      if (!selection.panoramaUrl) {
        destroyViewer();
        setViewerError('Fant ikke noe gatebilde for dette punktet.');
        return;
      }
      if (!viewerContainerRef.current) {
        return;
      }

      try {
        const pannellum = await ensurePannellum();
        if (cancelled) return;
        destroyViewer();
        const initial = viewerOptionsRef.current;
        pannellumInstanceRef.current = pannellum.viewer(viewerContainerRef.current, {
          type: 'equirectangular',
          panorama: selection.panoramaUrl,
          autoLoad: true,
          mouseZoom: true,
          doubleClickZoom: true,
          compass: false,
          // The product draws its own controls, in its style and in bokmål.
          showZoomCtrl: false,
          showFullscreenCtrl: false,
          yaw: initial.yaw,
          pitch: initial.pitch,
          hfov: initial.hfov,
          minHfov: 50,
          maxHfov: 120,
          minPitch: -90,
          maxPitch: 90,
          strings: PANNELLUM_STRINGS
        });
        setViewerError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Gatebildet kunne ikke vises.';
        setViewerError(message);
        console.error('Streetview viewer initialisation failed', err);
        destroyViewer();
      }
    };

    renderViewer();

    return () => {
      cancelled = true;
    };
    // Only a new selection re-creates the viewer. Metadata arriving later
    // (heading/pitch/hfov) is applied to the live instance below; tearing the
    // viewer down for it caused a visible flash and a second image download.
  }, [selection]);

  useEffect(() => {
    viewerOptionsRef.current = computeViewerOptions;
    const viewer = pannellumInstanceRef.current;
    if (!viewer) return;
    viewer.setYaw?.(computeViewerOptions.yaw);
    viewer.setPitch?.(computeViewerOptions.pitch);
    viewer.setHfov?.(computeViewerOptions.hfov);
  }, [computeViewerOptions]);

  if (!selection) {
    return null;
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-dialog">
      <div
        ref={rootRef}
        role="dialog"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="relative w-full border-t border-border-default bg-surface-default shadow-[0_-20px_60px_rgba(15,23,42,0.45)]"
        style={{ minHeight: '50vh' }}
      >
        <h2 id={titleId} className="sr-only">Gatebilde</h2>
        <div className="relative w-full" style={{ height: '50vh' }}>
          <button
            type="button"
            className="absolute right-4 top-4 z-10 rounded-full bg-surface-default/90 p-2 text-text-subtle shadow transition hover:bg-surface-default hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
            ref={closeRef}
            onClick={onClose}
            aria-label="Lukk gatebilde"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {selection.panoramaUrl && !viewerError && (
            <div className="absolute right-4 top-16 z-10 flex flex-col gap-2">
              <div
                role="group"
                aria-label="Zoom i gatebildet"
                className="flex flex-col rounded-lg border border-border-default bg-surface-default shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => zoomBy(-10)}
                  aria-label="Zoom inn i gatebildet"
                  title="Zoom inn"
                  className={`${panoControlClass} rounded-t-[9px]`}
                >
                  <svg {...panoGlyph}>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => zoomBy(10)}
                  aria-label="Zoom ut i gatebildet"
                  title="Zoom ut"
                  className={`${panoControlClass} rounded-b-[9px] border-t border-border-subtle`}
                >
                  <svg {...panoGlyph}>
                    <path d="M5 12h14" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                onClick={() => pannellumInstanceRef.current?.toggleFullscreen?.()}
                aria-label="Vis gatebildet i fullskjerm"
                title="Fullskjerm"
                className={`${panoControlClass} rounded-lg border border-border-default bg-surface-default shadow-sm`}
              >
                <svg {...panoGlyph}>
                  <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                </svg>
              </button>
            </div>
          )}
          {/* Metadata loading / error states (previously only fetched, never
              shown). Rendered as an overlay strip so they don't displace the
              panorama viewer. */}
          {loadingMetadata && (
            <div
              className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded bg-black/60 px-3 py-1.5 text-sm text-white shadow"
              aria-live="polite"
            >
              <Spinner data-size="sm" aria-hidden="true" />
              <span>Henter bildeinformasjon…</span>
            </div>
          )}
          {error && !loadingMetadata && (
            <div
              className="absolute left-4 top-4 z-10 max-w-[60%] rounded bg-danger-surface-default px-3 py-1.5 text-sm text-danger-text-default shadow"
              role="alert"
            >
              {error}
            </div>
          )}
          {selection.panoramaUrl ? (
            <>
              <div ref={viewerContainerRef} className="h-full w-full bg-black/10" />
              {imageDate && (
                <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded bg-black/60 px-3 py-1.5 text-sm text-white shadow">
                  <svg
                    className="h-4 w-4 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>{imageDate}</span>
                </div>
              )}
              {viewerError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-default/95 p-6 text-center text-sm text-danger-text-default">
                  <p>{viewerError}</p>
                  <img
                    src={selection.panoramaUrl}
                    alt="Gatebilde"
                    className="max-h-full w-full rounded-md object-contain"
                    loading="lazy"
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center bg-surface-tinted p-6 text-center text-base text-text-subtle">
              Fant ikke noe gatebilde for dette punktet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export type { StreetViewSelection };
export default StreetViewPanel;
