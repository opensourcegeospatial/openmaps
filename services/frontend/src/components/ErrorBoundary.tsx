import React from 'react';
import { STORED_LAYERS_KEY } from '../lib/customLayers';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Injected for tests; defaults to a full page reload. */
  reload?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const defaultReload = () => {
  if (typeof window !== 'undefined') window.location.reload();
};

/**
 * Last line of defence against a render/effect exception unmounting the whole
 * app to a blank page. Shows a Norwegian message with two ways out: reload,
 * or clear the locally persisted layer list (the one piece of client state
 * that can make a crash repeat on every reload) and then reload.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uventet feil i kartappen:', error, info.componentStack);
  }

  private reload = () => {
    (this.props.reload ?? defaultReload)();
  };

  private resetLocalData = () => {
    try {
      localStorage.removeItem(STORED_LAYERS_KEY);
      // Everything this app stores, not only the layers: the button says
      // "Nullstill lokale data" and must mean it (critique run 7).
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('openmaps.')) localStorage.removeItem(key);
      }
    } catch {
      // Storage may be unavailable; reloading is still the best we can do.
    }
    this.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex h-screen w-screen items-center justify-center bg-background-default p-6"
      >
        <div className="max-w-md rounded-lg border border-border-default bg-surface-default p-6 shadow-lg">
          <h1 className="text-lg font-medium text-text-default">Noe gikk galt</h1>
          <p className="mt-2 text-sm text-text-subtle">
            Kartet kunne ikke vises. Last siden på nytt. Hvis feilen kommer tilbake, kan et
            lagret kartlag være årsaken – da hjelper det å nullstille lokale data.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.reload}
              className="rounded-lg bg-main-base-default px-3 py-2 text-sm font-medium text-main-base-contrast-default transition hover:bg-main-base-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
            >
              Last siden på nytt
            </button>
            <button
              type="button"
              onClick={this.resetLocalData}
              className="rounded-lg border border-border-default px-3 py-2 text-sm font-medium text-text-default transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
            >
              Nullstill lokale data
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
