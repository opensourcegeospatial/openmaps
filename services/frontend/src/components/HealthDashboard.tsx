import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchHealth,
  type HealthResponse,
  type ServiceStatus,
} from '../lib/health';
import { setToastClearance } from '../lib/toastClearance';

/** How often (ms) to auto-refresh the health dashboard. */
const REFRESH_INTERVAL_MS = 30_000;

/** Human-friendly labels for each backend service name. */
const SERVICE_LABELS: Record<string, string> = {
  tileserver: 'Kartfliser',
  nominatim: 'Nominatim',
  'nominatim-ui': 'Nominatim UI',
  overpass: 'Overpass API',
  overpassbot: 'Overpass Bot',
  'overpass-ultra': 'Overpass Ultra',
  graphhopper: 'GraphHopper',
  'graphhopper-maps': 'GraphHopper Maps',
  llm: 'Språkmodell (LLM)',
  frontend: 'Kartklient',
};

/** Preferred display order — services not listed appear at the end. */
const SERVICE_ORDER = [
  'tileserver',
  'nominatim',
  'graphhopper',
  'overpass',
  'llm',
  'frontend',
  'nominatim-ui',
  'graphhopper-maps',
  'overpassbot',
  'overpass-ultra',
];

function statusColor(status: ServiceStatus): string {
  switch (status) {
    case 'healthy':
      return 'bg-success-base-default';
    case 'starting':
      return 'bg-warning-base-default';
    case 'unhealthy':
      return 'bg-danger-base-default';
  }
}

function statusLabel(status: ServiceStatus): string {
  switch (status) {
    case 'healthy':
      return 'I drift';
    case 'starting':
      return 'Starter';
    case 'unhealthy':
      return 'Utilgjengelig';
  }
}

function overallStatusText(health: HealthResponse | null): string {
  if (!health) return 'Får ikke kontakt med baksystemet';
  return health.status === 'healthy'
    ? 'Alle tjenester er i drift'
    : 'Noen tjenester er utilgjengelige';
}

function overallStatusColor(health: HealthResponse | null): string {
  if (!health) return 'text-danger-text-default';
  // warning-text-default (dark brown on light surface) is used instead of the
  // borderline yellow-600 flagged in the audit, so the text meets AA contrast.
  return health.status === 'healthy'
    ? 'text-success-text-default'
    : 'text-warning-text-default';
}

interface HealthDashboardProps {
  onClose: () => void;
}

const HealthDashboard: React.FC<HealthDashboardProps> = ({ onClose }) => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const titleId = React.useId();

  // Toasts stack at the top right, where this panel opens; while it is open
  // they start below it instead of covering it (lib/toastClearance.ts).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const place = () => setToastClearance('systemhelse', panel.getBoundingClientRect().bottom);
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(panel);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      setToastClearance('systemhelse', null);
    };
  }, []);
  // A small status panel beside the map, not a modal: it must not trap
  // keyboard focus away from the map and sidebar. Escape still closes it.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const result = await fetchHealth(signal);
    if (!signal?.aborted) {
      setHealth(result);
      setLastUpdated(new Date());
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);

    timerRef.current = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  // Sort services into the preferred display order
  const sortedServices = health
    ? Object.entries(health.services).sort(([a], [b]) => {
        const ai = SERVICE_ORDER.indexOf(a);
        const bi = SERVICE_ORDER.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
    : [];

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      className="absolute right-4 top-16 z-panel w-80 rounded-lg border border-border-default bg-surface-default shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="text-lg font-medium text-text-default">
            Systemhelse
          </h2>
          {loading && (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-default border-t-base-default" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
            title="Oppdater"
            aria-label="Oppdater systemhelse"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
            title="Lukk"
            aria-label="Lukk systemhelse"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Overall status */}
      <div className="border-b border-border-default px-4 py-2">
        <p className={`text-xs font-medium ${overallStatusColor(health)}`}>
          {overallStatusText(health)}
        </p>
      </div>

      {/* Service list */}
      <div className="max-h-72 overflow-y-auto px-4 py-2">
        {health === null && !loading && (
          <p className="py-4 text-center text-xs text-text-subtle">
            Sjekk at baksystemet kjører, og oppdater.
          </p>
        )}

        {sortedServices.map(([name, svc]) => (
          <div
            key={name}
            className="flex items-center justify-between py-1.5"
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor(svc.status)}`}
                title={statusLabel(svc.status)}
              />
              <span className="text-xs text-text-default">
                {SERVICE_LABELS[name] ?? name}
              </span>
            </div>
            <span
              className={`text-xs ${
                svc.status === 'healthy'
                  ? 'text-success-text-default'
                  : svc.status === 'starting'
                    ? 'text-warning-text-default'
                    : svc.optional
                      ? 'text-text-subtle'
                      : 'text-danger-text-default'
              }`}
            >
              {/* An optional UI being down is information, not a failure. */}
              {svc.optional && svc.status !== 'healthy'
                ? `${statusLabel(svc.status)} (valgfri)`
                : statusLabel(svc.status)}
            </span>
          </div>
        ))}
      </div>

      {/* Footer with last-updated timestamp */}
      {lastUpdated && (
        <div className="border-t border-border-default px-4 py-2">
          <p className="text-xs tabular-nums text-text-subtle">
            Sist sjekket:{' '}
            {lastUpdated.toLocaleTimeString('nb-NO', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </p>
        </div>
      )}
    </div>
  );
};

export default HealthDashboard;
