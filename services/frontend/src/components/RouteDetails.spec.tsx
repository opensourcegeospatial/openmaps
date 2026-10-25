import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import RouteDetails from './RouteDetails';
import type { RouteResult } from '../lib/graphhopper';
import { EMPTY_HIGHLIGHT, type RouteHighlight } from '../lib/routeDetails';

afterEach(cleanup);
beforeEach(() => sessionStorage.clear());

const coordinates = Array.from({ length: 11 }, (_, i) => [10.7522 - i * 0.0022, 59.9139]);
const base: RouteResult = {
  geometry: { type: 'LineString', coordinates },
  distance: 1226,
  time: 300000,
  instructions: [],
  primary: true,
  routeIndex: 0
};
const full: RouteResult = {
  ...base,
  elevation: [20, 22, 25, 27, 30, 32, 35, 33, 36, 40, 41],
  ascend: 23,
  descend: 2,
  details: {
    surface: [[0, 6, 'asphalt'], [6, 8, 'gravel'], [8, 10, 'asphalt']],
    road_environment: [[0, 3, 'road'], [3, 4, 'bridge'], [4, 10, 'road']],
    road_class: [[0, 5, 'cycleway'], [5, 10, 'residential']],
    max_speed: [[0, 4, null], [4, 10, 30]]
  }
};

function Harness({ route, spy }: { route: RouteResult; spy?: (h: RouteHighlight) => void }) {
  const [highlight, setHighlight] = useState<RouteHighlight>(EMPTY_HIGHLIGHT);
  React.useEffect(() => spy?.(highlight), [highlight, spy]);
  return <RouteDetails route={route} highlight={highlight} onHighlightChange={setHighlight} />;
}

describe('RouteDetails', () => {
  it('renders nothing for a route without elevation or details', () => {
    const { container } = render(<Harness route={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the profile, the surface, the crossings, and folds road type and speed', () => {
    render(<Harness route={full} />);
    expect(screen.getByRole('slider', { name: 'Høydeprofil' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Asfalt 80 %' })).toBeInTheDocument();
    expect(screen.getByText('1 bru · ingen tunnel · ingen ferje')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Vis veitype og fartsgrenser' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: 'Veitype' })).toBeNull();

    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Skjul veitype og fartsgrenser' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Sykkelvei 50 %' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 km/t 60 %' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ukjent 40 %' })).toBeInTheDocument();
  });

  it("on today's self-hosted data shows only the crossings and the fold", () => {
    const roadOnly: RouteResult = {
      ...base,
      details: { road_environment: full.details!.road_environment, road_class: full.details!.road_class, max_speed: full.details!.max_speed }
    };
    render(<Harness route={roadOnly} />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Underlag' })).toBeNull();
    expect(screen.getByText('1 bru · ingen tunnel · ingen ferje')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vis veitype og fartsgrenser' })).toBeInTheDocument();
  });

  it('previews, pins and unpins a category through the shared highlight', () => {
    const spy = vi.fn();
    render(<Harness route={full} spy={spy} />);
    const grus = screen.getByRole('button', { name: 'Grus 20 %' });
    fireEvent.focus(grus);
    expect(spy).toHaveBeenLastCalledWith({ position: null, preview: { key: 'surface', id: 'Grus' }, pinned: null });
    fireEvent.click(grus);
    expect(spy).toHaveBeenLastCalledWith({
      position: null,
      preview: { key: 'surface', id: 'Grus' },
      pinned: { key: 'surface', id: 'Grus' }
    });
    fireEvent.blur(grus);
    expect(spy).toHaveBeenLastCalledWith({ position: null, preview: null, pinned: { key: 'surface', id: 'Grus' } });
    fireEvent.click(grus);
    expect(spy).toHaveBeenLastCalledWith({ position: null, preview: null, pinned: null });
  });

  it('remembers the fold for the session', () => {
    const { unmount } = render(<Harness route={full} />);
    fireEvent.click(screen.getByRole('button', { name: 'Vis veitype og fartsgrenser' }));
    unmount();
    render(<Harness route={full} />);
    expect(screen.getByRole('button', { name: 'Skjul veitype og fartsgrenser' })).toBeInTheDocument();
  });
});
