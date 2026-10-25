import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import StreetViewPanel from './StreetViewPanel';

// The component dynamically imports the pannellum bundle, which would replace
// window.pannellum with the real library; stub the module so the fake below
// stays in place.
vi.mock('pannellum/build/pannellum.js', () => ({}));

interface FakeViewer {
  destroy: ReturnType<typeof vi.fn>;
  setYaw: ReturnType<typeof vi.fn>;
  setPitch: ReturnType<typeof vi.fn>;
  setHfov: ReturnType<typeof vi.fn>;
  getHfov: ReturnType<typeof vi.fn>;
  toggleFullscreen: ReturnType<typeof vi.fn>;
}

const viewers: FakeViewer[] = [];
const viewerFactory = vi.fn(() => {
  const v: FakeViewer = {
    destroy: vi.fn(),
    setYaw: vi.fn(),
    setPitch: vi.fn(),
    setHfov: vi.fn(),
    getHfov: vi.fn(() => 90),
    toggleFullscreen: vi.fn()
  };
  viewers.push(v);
  return v;
});

const selection = {
  id: 'p1',
  lngLat: { lng: 10.7, lat: 59.9 },
  geometry: { type: 'Point' as const, coordinates: [10.7, 59.9] },
  properties: {},
  panoramaUrl: '/api/streetview/panorama/p1'
};

beforeEach(() => {
  viewers.length = 0;
  viewerFactory.mockClear();
  (window as unknown as { pannellum: unknown }).pannellum = { viewer: viewerFactory };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { pannellum?: unknown }).pannellum;
});

const flush = () => act(async () => {});

describe('StreetViewPanel viewer lifecycle', () => {
  it('creates the viewer once per selection and applies late metadata in place', async () => {
    const { rerender } = render(
      <StreetViewPanel selection={selection} metadata={null} loadingMetadata error={null} onClose={() => {}} />
    );
    await flush();
    expect(viewerFactory).toHaveBeenCalledTimes(1);

    rerender(
      <StreetViewPanel
        selection={selection}
        metadata={{ heading: 90, pitch: 5, hfov: 80 }}
        loadingMetadata={false}
        error={null}
        onClose={() => {}}
      />
    );
    await flush();
    // Metadata arriving must not tear the viewer down (and re-download the image).
    expect(viewerFactory).toHaveBeenCalledTimes(1);
    expect(viewers[0].destroy).not.toHaveBeenCalled();
    expect(viewers[0].setYaw).toHaveBeenCalledWith(90);
    expect(viewers[0].setPitch).toHaveBeenCalledWith(5);
    expect(viewers[0].setHfov).toHaveBeenCalledWith(80);
  });

  it('re-creates the viewer when a different panorama is selected', async () => {
    const { rerender } = render(
      <StreetViewPanel selection={selection} metadata={null} loadingMetadata={false} error={null} onClose={() => {}} />
    );
    await flush();
    rerender(
      <StreetViewPanel
        selection={{ ...selection, id: 'p2', panoramaUrl: '/api/streetview/panorama/p2' }}
        metadata={null}
        loadingMetadata={false}
        error={null}
        onClose={() => {}}
      />
    );
    await flush();
    expect(viewerFactory).toHaveBeenCalledTimes(2);
    expect(viewers[0].destroy).toHaveBeenCalled();
  });
});

describe('StreetViewPanel as a non-modal panel', () => {
  it('does not claim to be modal or trap focus (the map above it stays usable)', async () => {
    render(
      <StreetViewPanel selection={selection} metadata={null} loadingMetadata={false} error={null} onClose={() => {}} />
    );
    await flush();
    const dialog = screen.getByRole('dialog', { name: 'Gatebilde' });
    expect(dialog).not.toHaveAttribute('aria-modal');
  });

  it('closes on Escape from inside the panel', async () => {
    const onClose = vi.fn();
    render(
      <StreetViewPanel selection={selection} metadata={null} loadingMetadata={false} error={null} onClose={onClose} />
    );
    await flush();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Gatebilde' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('StreetViewPanel controls', () => {
  it('zooms and goes fullscreen with its own controls, named in bokmål', async () => {
    render(
      <StreetViewPanel selection={selection} metadata={null} loadingMetadata={false} error={null} onClose={() => {}} />
    );
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom inn i gatebildet' }));
    expect(viewers[0].setHfov).toHaveBeenLastCalledWith(80);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom ut i gatebildet' }));
    expect(viewers[0].setHfov).toHaveBeenLastCalledWith(100);
    fireEvent.click(screen.getByRole('button', { name: 'Vis gatebildet i fullskjerm' }));
    expect(viewers[0].toggleFullscreen).toHaveBeenCalled();
  });
});
