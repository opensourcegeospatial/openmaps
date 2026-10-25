import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import NavigationPanel from './NavigationPanel';
import { Geocode } from '../lib/nominatim';

const noop = () => {};

function renderPanel(overrides: Partial<React.ComponentProps<typeof NavigationPanel>> = {}) {
  const onWaypointsChange = vi.fn();
  render(
    <NavigationPanel
      fromLocation={{ coords: { lng: 10.7, lat: 59.9 }, name: 'Oslo' }}
      toLocation={{ coords: { lng: 5.3, lat: 60.4 }, name: 'Bergen' }}
      waypoints={[]}
      routingProfile="car"
      onFromChange={noop}
      onToChange={noop}
      onWaypointsChange={onWaypointsChange}
      onProfileChange={noop}
      onSwapLocations={noop}
      onClose={noop}
      {...overrides}
    />
  );
  return { onWaypointsChange };
}

afterEach(cleanup);

describe('NavigationPanel via points', () => {
  it('adds an unresolved row (coords null) instead of a point at 0,0', () => {
    const { onWaypointsChange } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Legg til viapunkt' }));
    expect(onWaypointsChange).toHaveBeenCalledWith([{ coords: null, name: '' }]);
  });

  it('removes a via row from inside its field, never leaving a point at 0,0', () => {
    const { onWaypointsChange } = renderPanel({
      waypoints: [{ coords: { lng: 10.5, lat: 59.5 }, name: 'Drammen' }]
    });
    // A via row has one in-field action, remove; the stops keep their clear "×".
    expect(screen.queryByRole('button', { name: 'Tøm viapunkt 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tøm startpunkt' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fjern viapunkt 1' }));
    expect(onWaypointsChange).toHaveBeenCalledWith([]);
  });

  it('asks where before how: the fields come before the Reisemiddel group, Kjør preselected', () => {
    renderPanel();
    const destination = screen.getByRole('combobox', { name: 'Destinasjon' });
    const drive = screen.getByRole('button', { name: 'Kjør' });
    expect(drive).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Gå' })).toHaveAttribute('aria-pressed', 'false');
    expect(destination.compareDocumentPosition(drive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing about a route is asked for before one exists.
    expect(screen.queryByRole('checkbox', { name: 'Vis alternative ruter' })).toBeNull();
  });
});

vi.mock('../lib/nominatim', () => ({
  Geocode: vi.fn(async () => [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [10.75, 59.91] },
      properties: { display_name: 'Oslo, Norge', name: 'Oslo', osm_id: 1 }
    }
  ])
}));

describe('NavigationPanel location inputs', () => {
  it('does not pop the start-point suggestions when the panel opens with a preset start', async () => {
    vi.useFakeTimers();
    try {
      renderPanel({ fromLocation: { coords: { lng: 10.7, lat: 59.9 }, name: 'Oslo, Norge' } });
      // The debounced search window plus a tick for the (mocked) fetch.
      await vi.advanceTimersByTimeAsync(400);
      expect(screen.queryByRole('listbox', { name: 'Startpunkt – forslag' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NavigationPanel keyboard access to suggestions', () => {
  it('ArrowDown + Enter selects the highlighted destination suggestion', async () => {
    vi.useFakeTimers();
    try {
      const onToChange = vi.fn();
      renderPanel({ toLocation: null, onToChange });
      const input = screen.getByRole('combobox', { name: 'Destinasjon' });
      input.focus();
      fireEvent.change(input, { target: { value: 'Oslo' } });
      await vi.advanceTimersByTimeAsync(400);

      const listbox = screen.getByRole('listbox', { name: 'Destinasjon – forslag' });
      expect(listbox).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      const option = screen.getByRole('option', { name: /Oslo, Norge/ });
      expect(option).toHaveAttribute('aria-selected', 'true');
      expect(input).toHaveAttribute('aria-activedescendant', option.id);

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onToChange).toHaveBeenCalledWith({ coords: { lng: 10.75, lat: 59.91 }, name: 'Oslo, Norge' });
      expect(screen.queryByRole('listbox', { name: 'Destinasjon – forslag' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape closes the suggestion list without selecting', async () => {
    vi.useFakeTimers();
    try {
      const onToChange = vi.fn();
      renderPanel({ toLocation: null, onToChange });
      const input = screen.getByRole('combobox', { name: 'Destinasjon' });
      input.focus();
      fireEvent.change(input, { target: { value: 'Oslo' } });
      await vi.advanceTimersByTimeAsync(400);
      expect(screen.getByRole('listbox', { name: 'Destinasjon – forslag' })).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('listbox', { name: 'Destinasjon – forslag' })).toBeNull();
      expect(onToChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking a suggestion (mouse) still selects it', async () => {
    vi.useFakeTimers();
    try {
      const onToChange = vi.fn();
      renderPanel({ toLocation: null, onToChange });
      const input = screen.getByRole('combobox', { name: 'Destinasjon' });
      input.focus();
      fireEvent.change(input, { target: { value: 'Oslo' } });
      await vi.advanceTimersByTimeAsync(400);
      fireEvent.click(screen.getByRole('option', { name: /Oslo, Norge/ }));
      expect(onToChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NavigationPanel empty via rows', () => {
  it('says an empty row is skipped, and offers only one at a time', () => {
    renderPanel({ waypoints: [{ coords: null, name: '' }] });
    expect(screen.getByText('Tomt – hoppes over')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Legg til viapunkt' })).toBeDisabled();
  });

  it('offers another row once the empty one is filled', () => {
    renderPanel({ waypoints: [{ coords: { lng: 10.5, lat: 59.5 }, name: 'Drammen' }] });
    expect(screen.queryByText('Tomt – hoppes over')).toBeNull();
    expect(screen.getByRole('button', { name: 'Legg til viapunkt' })).toBeEnabled();
  });
});

describe('NavigationPanel stop names', () => {
  const kaffe = 'Kaffebrenneriet Storgata, 12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge';

  it('reads a picked stop by its short name at rest, and gives back the full address on focus', () => {
    renderPanel({ fromLocation: { coords: { lng: 10.75, lat: 59.91 }, name: kaffe } });
    const start = screen.getByRole('combobox', { name: 'Startpunkt' }) as HTMLInputElement;
    expect(start).toHaveValue('Kaffebrenneriet Storgata');
    expect(start).toHaveAttribute('title', kaffe);
    expect(start).toHaveAccessibleDescription(kaffe);

    act(() => start.focus());
    expect(start).toHaveValue(kaffe);
    // Selected, so typing a new place replaces it.
    expect([start.selectionStart, start.selectionEnd]).toEqual([0, kaffe.length]);
    expect(start).not.toHaveAttribute('title');

    act(() => start.blur());
    expect(start).toHaveValue('Kaffebrenneriet Storgata');
  });

  it('tells apart two via points that would read the same', () => {
    renderPanel({
      waypoints: [
        { coords: { lng: 10.75, lat: 59.91 }, name: 'Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge' },
        { coords: { lng: 11.05, lat: 59.95 }, name: 'Storgata, Lillestrøm, Akershus, Norge' }
      ]
    });
    expect(screen.getByRole('combobox', { name: 'Viapunkt 1' })).toHaveValue('Storgata, Sentrum');
    expect(screen.getByRole('combobox', { name: 'Viapunkt 2' })).toHaveValue('Storgata, Lillestrøm');
  });

  it('shows what the user is typing, not the short name, while they type it', () => {
    renderPanel({ toLocation: { coords: { lng: 5.32, lat: 60.39 }, name: 'Bergen, Vestland, Norge' } });
    const destination = screen.getByRole('combobox', { name: 'Destinasjon' });
    expect(destination).toHaveValue('Bergen');
    act(() => destination.focus());
    fireEvent.change(destination, { target: { value: 'Berg' } });
    expect(destination).toHaveValue('Berg');
    expect(destination).not.toHaveAttribute('title');
  });

  // The route follows the picked stop until another is picked, so text left
  // behind unpicked made the panel say one thing while the map did another —
  // one keystroke over a selected field was enough (critique run 15).
  it('puts the picked stop back when a draft is left behind, by Escape or by leaving', () => {
    renderPanel({ toLocation: { coords: { lng: 5.32, lat: 60.39 }, name: 'Bergen, Vestland, Norge' } });
    const destination = screen.getByRole('combobox', { name: 'Destinasjon' });

    act(() => destination.focus());
    fireEvent.change(destination, { target: { value: 'x' } });
    fireEvent.keyDown(destination, { key: 'Escape' });
    expect(destination).toHaveValue('Bergen, Vestland, Norge');

    fireEvent.change(destination, { target: { value: 'x' } });
    act(() => destination.blur());
    expect(destination).toHaveValue('Bergen');
  });

  // A stop nobody has picked yet has nothing to go back to: the text stays.
  it('keeps a draft in a field with no picked stop', () => {
    renderPanel({ toLocation: null });
    const destination = screen.getByRole('combobox', { name: 'Destinasjon' });
    act(() => destination.focus());
    fireEvent.change(destination, { target: { value: 'Berg' } });
    fireEvent.keyDown(destination, { key: 'Escape' });
    act(() => destination.blur());
    expect(destination).toHaveValue('Berg');
  });
});

describe('NavigationPanel search feedback', () => {
  it('says when no place matches what was typed', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(Geocode).mockResolvedValueOnce([]);
      renderPanel({ toLocation: null });
      const input = screen.getByRole('combobox', { name: 'Destinasjon' });
      input.focus();
      fireEvent.change(input, { target: { value: 'Xyzzy' } });
      await vi.advanceTimersByTimeAsync(400);
      expect(screen.getByRole('status')).toHaveTextContent('Ingen steder funnet for «Xyzzy».');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers Prøv igjen after a failed lookup, and searches again', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(Geocode).mockRejectedValueOnce(new Error('down'));
      renderPanel({ toLocation: null });
      const input = screen.getByRole('combobox', { name: 'Destinasjon' });
      input.focus();
      fireEvent.change(input, { target: { value: 'Oslo' } });
      await vi.advanceTimersByTimeAsync(400);
      expect(screen.getByRole('alert')).toHaveTextContent('Søket kunne ikke utføres.');

      fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
      await vi.advanceTimersByTimeAsync(400);
      expect(screen.getByRole('listbox', { name: 'Destinasjon – forslag' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
