import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import SearchField from './SearchField';
import { searchOverpass } from '../lib/overpass';
import { Geocode } from '../lib/nominatim';
import type { ComponentProps } from 'react';
import type { StoredPlace } from '../lib/places';

vi.mock('../lib/overpass', () => ({ searchOverpass: vi.fn() }));
vi.mock('../lib/nominatim', () => ({ Geocode: vi.fn(async () => []) }));

const bounds = { north: 60, south: 59, east: 11, west: 10 };
const mapRef = { current: { getBounds: () => bounds } } as unknown as React.RefObject<
  import('./Map').MapHandle
>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SearchField Overpass search', () => {
  it('aborts a pending search when the field is cleared and ignores its late result', async () => {
    let resolveSearch: (result: unknown) => void = () => {};
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(searchOverpass).mockImplementation((_q, _b, signal) => {
      receivedSignal = signal;
      return new Promise((resolve) => {
        resolveSearch = resolve as (result: unknown) => void;
      });
    });
    const onOverpassResults = vi.fn();
    const onChange = vi.fn();

    render(
      <SearchField
        value="cafes"
        onChange={onChange}
        placeholder="Beskriv hva du leter etter..."
        mode="overpass"
        mapRef={mapRef}
        onSelect={() => {}}
        onOverpassResults={onOverpassResults}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Søk' }));
    expect(searchOverpass).toHaveBeenCalledTimes(1);
    expect(receivedSignal?.aborted).toBe(false);

    // Clearing the field (the clear button is hidden while loading; the
    // component exposes clearing through onChange('') too) must cancel.
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt søk' }));
    expect(receivedSignal?.aborted).toBe(true);

    await act(async () => {
      resolveSearch({ features: [{ type: 'Feature', geometry: null, properties: {} }] });
    });
    expect(onOverpassResults).not.toHaveBeenCalled();
  });

  it('cancels a pending search when the mode switches back to place search', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(searchOverpass).mockImplementation((_q, _b, signal) => {
      receivedSignal = signal;
      return new Promise(() => {});
    });
    const { rerender } = render(
      <SearchField
        value="cafes"
        onChange={() => {}}
        placeholder="x"
        mode="overpass"
        mapRef={mapRef}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Søk' }));
    expect(receivedSignal?.aborted).toBe(false);

    rerender(
      <SearchField
        value="cafes"
        onChange={() => {}}
        placeholder="x"
        mode="nominatim"
        mapRef={mapRef}
        onSelect={() => {}}
      />
    );
    expect(receivedSignal?.aborted).toBe(true);
  });
});

describe('SearchField place search', () => {
  it('sends the current map view along with the query', async () => {
    vi.useFakeTimers();
    try {
      render(
        <SearchField
          value="Storgata"
          onChange={() => {}}
          placeholder="Søk etter steder..."
          mode="nominatim"
          mapRef={mapRef}
          onSelect={() => {}}
        />
      );
      // The field debounces geocoding by 300 ms.
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(Geocode).toHaveBeenCalledWith('Storgata', { viewbox: bounds });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SearchField saved and recent places', () => {
  const oslo: StoredPlace = {
    id: 'node:1',
    name: 'Oslo, Norge',
    lat: 59.9139,
    lng: 10.7522,
    category: 'city',
    savedAt: 1
  };
  const bergen: StoredPlace = { id: 'node:2', name: 'Bergen, Norge', lat: 60.39, lng: 5.32, savedAt: 2 };

  const renderEmptyField = (props: Partial<ComponentProps<typeof SearchField>> = {}) =>
    render(
      <SearchField
        value=""
        onChange={() => {}}
        placeholder="Søk etter steder..."
        mode="nominatim"
        mapRef={mapRef}
        onSelect={() => {}}
        savedPlaces={[oslo]}
        recentPlaces={[bergen]}
        {...props}
      />
    );

  it('lists saved and recent places only while the empty field has focus', () => {
    renderEmptyField();
    expect(screen.queryByRole('group', { name: 'Mine steder' })).toBeNull();

    fireEvent.focus(screen.getByPlaceholderText('Søk etter steder...'));
    expect(screen.getByRole('group', { name: 'Mine steder' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gå til Oslo, Norge' })).toBeInTheDocument();
    expect(screen.getByText('By · Norge')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Nylige søk' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gå til Bergen, Norge' })).toBeInTheDocument();

    fireEvent.blur(screen.getByPlaceholderText('Søk etter steder...'));
    expect(screen.queryByRole('group', { name: 'Mine steder' })).toBeNull();
  });

  it('hands a point feature to onSelect and fills the field when a place is picked', () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    renderEmptyField({ onSelect, onChange });

    fireEvent.focus(screen.getByPlaceholderText('Søk etter steder...'));
    fireEvent.click(screen.getByRole('option', { name: 'Gå til Oslo, Norge' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const feature = onSelect.mock.calls[0][0];
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [10.7522, 59.9139] });
    expect(feature.properties.display_name).toBe('Oslo, Norge');
    expect(onChange).toHaveBeenCalledWith('Oslo, Norge');
  });

  it('keeps the lists hidden while the user is typing', () => {
    renderEmptyField({ value: 'Sta' });
    fireEvent.focus(screen.getByPlaceholderText('Søk etter steder...'));
    expect(screen.queryByRole('group', { name: 'Mine steder' })).toBeNull();
  });

  it('shows nothing when both lists are empty', () => {
    renderEmptyField({ savedPlaces: [], recentPlaces: [] });
    fireEvent.focus(screen.getByPlaceholderText('Søk etter steder...'));
    expect(screen.queryByRole('group', { name: 'Mine steder' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Nylige søk' })).toBeNull();
  });

  it('moves through the saved and recent places with the arrow keys and picks with Enter', () => {
    const onSelect = vi.fn();
    renderEmptyField({ onSelect });
    const input = screen.getByPlaceholderText('Søk etter steder...');
    fireEvent.focus(input);
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const bergen = screen.getByRole('option', { name: 'Gå til Bergen, Norge' });
    expect(bergen).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', bergen.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect.mock.calls[0][0].properties.display_name).toBe('Bergen, Norge');
  });

  it('offers to clear the recent searches', () => {
    const onClearRecent = vi.fn();
    renderEmptyField({ onClearRecent });
    fireEvent.focus(screen.getByPlaceholderText('Søk etter steder...'));
    fireEvent.click(screen.getByRole('button', { name: 'Tøm nylige søk' }));
    expect(onClearRecent).toHaveBeenCalledTimes(1);
  });
});

describe('SearchField empty result', () => {
  it('says so when a completed place search found nothing', async () => {
    vi.mocked(Geocode).mockResolvedValueOnce([]);
    render(
      <SearchField
        value="Xyzzy"
        onChange={() => {}}
        placeholder="Søk etter steder..."
        mode="nominatim"
        mapRef={mapRef}
        onSelect={() => {}}
      />
    );
    expect(
      await screen.findByText(/Ingen steder funnet for «Xyzzy»/, undefined, { timeout: 2000 })
    ).toBeInTheDocument();
  });
});

/**
 * The default screen's only permanent teaching: one line on what the map
 * itself answers. The second line, pointing at the tools in the corners, was
 * removed at the user's request (2026-09-23).
 */
describe('SearchField default-screen teaching', () => {
  const renderHint = (props: Partial<ComponentProps<typeof SearchField>> = {}) =>
    render(
      <SearchField
        value=""
        onChange={() => {}}
        placeholder="Søk etter sted eller adresse…"
        mode="nominatim"
        mapRef={mapRef}
        onSelect={() => {}}
        showMapHint
        {...props}
      />
    );

  it('says what the map answers, and nothing about where the tools are', () => {
    renderHint();
    expect(screen.getByText('Klikk i kartet for å se stedet eller adressen der.')).toBeInTheDocument();
    expect(screen.queryByText(/nederst til høyre/)).toBeNull();
    expect(screen.queryByText(/egne kartlag/)).toBeNull();
  });

  it('steps aside once the shell has something else to show', () => {
    renderHint({ showMapHint: false });
    expect(screen.queryByText('Klikk i kartet for å se stedet eller adressen der.')).toBeNull();
  });
});

describe('SearchField coordinates', () => {
  const HINT = /Skriv eller lim inn/;
  const NOT_READ = /Kjenner ikke igjen koordinatene/;

  const Field = ({
    initial = '',
    ...props
  }: { initial?: string } & Partial<ComponentProps<typeof SearchField>>) => {
    const [value, setValue] = useState(initial);
    return (
      <SearchField
        value={value}
        onChange={setValue}
        placeholder=""
        mode="coordinates"
        mapRef={mapRef}
        onSelect={() => {}}
        {...props}
      />
    );
  };

  const typeInto = (input: HTMLElement, value: string) => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
  };

  it('teaches the formats while the field is empty', () => {
    render(<Field />);
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('lists what it understood, with what it took the text to be', () => {
    render(<Field />);
    typeInto(screen.getByRole('combobox'), '32V 597980 6643119');
    const option = screen.getByRole('option');
    expect(option.textContent).toContain('59,91390° N, 10,75220° Ø');
    expect(option.textContent).toContain('UTM sone 32V');
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('never sends a coordinate to the place search', async () => {
    vi.useFakeTimers();
    try {
      render(<Field />);
      typeInto(screen.getByRole('combobox'), '59,9139 10,7522');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(Geocode).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the first reading on Enter and keeps what was pasted in the field', () => {
    const onSelect = vi.fn();
    render(<Field onSelect={onSelect} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    typeInto(input, '10,7522 59,9139');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].geometry.coordinates).toEqual([59.9139, 10.7522]);
    expect(input.value).toBe('10,7522 59,9139');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('reaches the other reading with the arrow keys', () => {
    const onSelect = vi.fn();
    render(<Field onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    typeInto(input, '10,7522 59,9139');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect.mock.calls[0][0].geometry.coordinates).toEqual([10.7522, 59.9139]);
  });

  it('picks a reading by click', () => {
    const onSelect = vi.fn();
    render(<Field onSelect={onSelect} />);
    typeInto(screen.getByRole('combobox'), '10,7522 59,9139');
    fireEvent.click(screen.getAllByRole('option')[1]);
    expect(onSelect.mock.calls[0][0].geometry.coordinates).toEqual([10.7522, 59.9139]);
  });

  it('brings the readings back when the field is focused again, so another can be chosen', () => {
    render(<Field />);
    const input = screen.getByRole('combobox');
    typeInto(input, '10,7522 59,9139');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.blur(input);
    fireEvent.focus(input);
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('goes there again on Enter with the readings put away', () => {
    const onSelect = vi.fn();
    render(<Field onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    typeInto(input, '59,9139 N 10,7522 Ø');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('puts the readings away on Escape and brings them back with the next edit', () => {
    render(<Field />);
    const input = screen.getByRole('combobox');
    typeInto(input, '59,9139 10,7522');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.change(input, { target: { value: '59,9139 10,75' } });
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('keeps the teaching line, not an error, while the text is still being typed', () => {
    render(<Field />);
    typeInto(screen.getByRole('combobox'), '32V 5979');
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(screen.queryByText(NOT_READ)).toBeNull();
  });

  it('says what is wrong on Enter, and withdraws it at the next edit', () => {
    const onSelect = vi.fn();
    render(<Field onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    typeInto(input, '59,9139 190,7522');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/Lengdegrad må være mellom/)).toBeTruthy();
    fireEvent.change(input, { target: { value: '59,9139 190,752' } });
    expect(screen.queryByText(/Lengdegrad må være mellom/)).toBeNull();
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('says what is wrong at once when the text was pasted', () => {
    render(<Field />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.paste(input);
    fireEvent.change(input, { target: { value: 'rådhusplassen' } });
    expect(screen.getByText(NOT_READ)).toBeTruthy();
  });

  it('does not count a paste made in another mode', () => {
    const { rerender } = render(<Field mode="nominatim" />);
    fireEvent.paste(screen.getByRole('combobox'));
    rerender(<Field mode="coordinates" />);
    typeInto(screen.getByRole('combobox'), '5');
    expect(screen.queryByText(NOT_READ)).toBeNull();
  });

  it('announces the problem from a region that was already there', () => {
    render(<Field />);
    const input = screen.getByRole('combobox');
    const region = screen.getByText(HINT);
    expect(region.getAttribute('role')).toBe('status');
    typeInto(input, 'rådhusplassen');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(region.textContent).toMatch(NOT_READ);
    expect(region.isConnected).toBe(true);
  });

  it('announces how the text was read', () => {
    render(<Field />);
    const input = screen.getByRole('combobox');
    typeInto(input, '32V 597980 6643119');
    expect(screen.getByText('Lest som 59,91390° N, 10,75220° Ø, UTM sone 32V').getAttribute('role')).toBe('status');
    typeInto(input, '10,7522 59,9139');
    expect(screen.getByText('2 mulige plasseringer').getAttribute('role')).toBe('status');
  });

  it('abandons a running area search when the mode switches to coordinates', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(searchOverpass).mockImplementation((_q, _b, signal) => {
      receivedSignal = signal;
      return new Promise(() => {});
    });
    const props = { value: 'cafes', onChange: () => {}, placeholder: '', mapRef, onSelect: () => {} };
    const { rerender } = render(<SearchField {...props} mode="overpass" />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await act(async () => {});
    expect(receivedSignal?.aborted).toBe(false);
    rerender(<SearchField {...props} value="" mode="coordinates" />);
    expect(receivedSignal?.aborted).toBe(true);
    expect(screen.queryByText('Avbryt søk')).toBeNull();
  });
});
