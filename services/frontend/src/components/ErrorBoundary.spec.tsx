import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

const Boom: React.FC = () => {
  throw new Error('kaboom');
};

describe('ErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    // React logs the caught error; keep test output clean.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>alt vel</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('alt vel')).toBeInTheDocument();
  });

  it('shows a Norwegian fallback instead of a blank page when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Noe gikk galt');
    expect(screen.getByRole('button', { name: 'Last siden på nytt' })).toBeInTheDocument();
  });

  it('"Nullstill lokale data" clears persisted layers and reloads', () => {
    localStorage.setItem('customMapLayers', '[{"id":"x"}]');
    const reload = vi.fn();
    render(
      <ErrorBoundary reload={reload}>
        <Boom />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nullstill lokale data' }));
    expect(localStorage.getItem('customMapLayers')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
