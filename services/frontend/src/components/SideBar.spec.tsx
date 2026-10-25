import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import SideBar from './SideBar';
import type { GeoJSONFeature } from '../lib/nominatim';

afterEach(cleanup);

const feature: GeoJSONFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
  properties: { display_name: 'Oslo, Norge' }
};

const noop = () => {};

const renderSideBar = (props: Partial<ComponentProps<typeof SideBar>> = {}) =>
  render(
    <SideBar
      feature={feature}
      routeFeature={null}
      routes={null}
      routingStatus="idle"
      selectedRouteIndex={0}
      onSelectRoute={noop}
      alternativesEnabled={false}
      onToggleAlternatives={noop}
      avoidAreasCount={0}
      onClearAvoidAreas={noop}
      navigationMode={false}
      fromLocation={null}
      toLocation={null}
      waypointLocations={[]}
      routingProfile="car"
      onClose={noop}
      onJumpTo={noop}
      onNavigateFrom={noop}
      onNavigateTo={noop}
      onStartNavigation={noop}
      onFromChange={noop}
      onToChange={noop}
      onWaypointsChange={noop}
      onProfileChange={noop}
      onSwapLocations={noop}
      onCloseNavigation={noop}
      {...props}
    />
  );

describe('SideBar Mine steder', () => {
  it('offers to save an unsaved place and reports the click', () => {
    const onToggleSaved = vi.fn();
    renderSideBar({ isSaved: false, onToggleSaved });

    const button = screen.getByRole('button', { name: 'Lagre i Mine steder' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(onToggleSaved).toHaveBeenCalledTimes(1);
  });

  it('shows a saved place as pressed, with the remove label', () => {
    renderSideBar({ isSaved: true, onToggleSaved: vi.fn() });
    expect(screen.getByRole('button', { name: 'Fjern fra Mine steder' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('renders no star without a toggle handler', () => {
    renderSideBar();
    expect(screen.getByRole('heading', { name: 'Oslo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mine steder/ })).toBeNull();
  });
});

const oslo = { coords: { lng: 10.7522, lat: 59.9139 }, name: 'Oslo, Norge' };
const station = { coords: { lng: 10.7528, lat: 59.9108 }, name: 'Oslo Sentralstasjon, Oslo, Norge' };
const route = {
  routeIndex: 0,
  primary: true,
  distance: 2000,
  time: 150000,
  instructions: [{ text: 'Kjør mot sørvest', distance: 2000, time: 150000, interval: [0, 1] }],
  geometry: { type: 'LineString' as const, coordinates: [[10.7522, 59.9139], [10.7528, 59.9108]] }
};

const follows = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('SideBar route results', () => {
  it('shows nothing about a route before one exists', () => {
    renderSideBar({ feature: null, navigationMode: true, fromLocation: oslo });
    expect(screen.queryByRole('checkbox', { name: 'Vis alternative ruter' })).toBeNull();
    expect(screen.queryByText('Avstand')).toBeNull();
  });

  it('puts the answer beneath the question and offers alternatives only then', () => {
    renderSideBar({
      feature: null,
      navigationMode: true,
      fromLocation: oslo,
      toLocation: station,
      routes: [route]
    });
    const drive = screen.getByRole('button', { name: 'Kjør' });
    const summary = screen.getByText('Avstand');
    const toggle = screen.getByRole('checkbox', { name: 'Vis alternative ruter' });
    expect(follows(screen.getByRole('combobox', { name: 'Destinasjon' }), drive)).toBe(true);
    expect(follows(drive, summary)).toBe(true);
    expect(follows(summary, toggle)).toBe(true);
    expect(toggle).toBeEnabled();
    expect(screen.getByText('2 km')).toBeInTheDocument();
    expect(screen.getByRole('list')).toContainElement(screen.getByText('Kjør mot sørvest'));
  });

  it('keeps alternative routes available while the only via row is unresolved', () => {
    renderSideBar({
      feature: null,
      navigationMode: true,
      fromLocation: oslo,
      toLocation: station,
      routes: [route],
      waypointLocations: [{ coords: null, name: '' }]
    });
    expect(screen.getByRole('checkbox', { name: 'Vis alternative ruter' })).toBeEnabled();
  });

  it('disables alternatives once a via point is resolved', () => {
    renderSideBar({
      feature: null,
      navigationMode: true,
      fromLocation: oslo,
      toLocation: station,
      routes: [route],
      waypointLocations: [{ coords: { lng: 10.5, lat: 59.5 }, name: 'Drammen' }]
    });
    expect(screen.getByRole('checkbox', { name: 'Vis alternative ruter' })).toBeDisabled();
    expect(screen.getByText('Ikke tilgjengelig med viapunkter')).toBeInTheDocument();
  });
});

describe('SideBar route results with via points and failures', () => {
  const alternative = { ...route, routeIndex: 1, primary: false, distance: 2600, time: 180000 };

  it('hides the route list once a via point is resolved, since alternatives are off', () => {
    renderSideBar({
      feature: null,
      navigationMode: true,
      fromLocation: oslo,
      toLocation: station,
      routes: [route, alternative],
      waypointLocations: [{ coords: { lng: 10.5, lat: 59.5 }, name: 'Drammen' }]
    });
    expect(screen.queryByRole('heading', { name: 'Ruter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rute 2' })).toBeNull();
    expect(screen.getByText('Avstand')).toBeInTheDocument();
  });

  it('names the travel mode of the route it still shows after a failure', () => {
    renderSideBar({
      feature: null,
      navigationMode: true,
      fromLocation: oslo,
      toLocation: station,
      routes: [route],
      routingStatus: 'error',
      routingErrorMessage: 'Kunne ikke beregne ruten. Rutetjenesten svarer ikke.',
      routingProfile: 'foot',
      routeProfile: 'car'
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Viser forrige rute (Kjør).');
    expect(screen.getByText('Forrige rute')).toBeInTheDocument();
  });

  it('offers "Prøv igjen" in the error banner and reports the click', () => {
    const onRetryRoute = vi.fn();
    renderSideBar({
      feature: null,
      navigationMode: true,
      fromLocation: oslo,
      toLocation: station,
      routingStatus: 'error',
      onRetryRoute
    });
    const banner = screen.getByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(onRetryRoute).toHaveBeenCalledTimes(1);
    expect(banner).toHaveTextContent('Kunne ikke beregne ruten');
  });
});

describe('SideBar place card', () => {
  it('makes the place the headline, what and where it is one line under it, and its directions one row', () => {
    renderSideBar({ feature: { ...feature, properties: { display_name: 'Oslo, Norge', type: 'city' } } });
    const card = screen.getByRole('region', { name: 'Detaljer' });
    const heading = within(card).getByRole('heading', { level: 2, name: 'Oslo' });
    // No label above the name: its type and locality follow it, as in the search results.
    expect(follows(heading, within(card).getByText('By · Norge'))).toBe(true);
    expect(within(card).queryByText('Kategori')).toBeNull();
    const directions = within(card).getByRole('group', { name: 'Veibeskrivelse' });
    expect(within(directions).getByRole('button', { name: 'Veibeskrivelse herfra' })).toHaveTextContent('Herfra');
    expect(within(directions).getByRole('button', { name: 'Veibeskrivelse hit' })).toHaveTextContent('Hit');
  });

  it('headlines a street address without repeating it as an address row', () => {
    renderSideBar({
      feature: {
        ...feature,
        properties: {
          display_name: '12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge',
          address: { road: 'Storgata', house_number: '12', postcode: '0184', city: 'Oslo' }
        }
      }
    });
    const card = screen.getByRole('region', { name: 'Detaljer' });
    expect(within(card).getByRole('heading', { level: 2, name: 'Storgata 12' })).toBeInTheDocument();
    expect(within(card).getByText('0184 Oslo')).toBeInTheDocument();
    expect(within(card).queryByText('Adresse')).toBeNull();
  });

  it('offers to ask again when the lookup failed, and copies the coordinates it did get', () => {
    const onRetryFeature = vi.fn();
    renderSideBar({
      feature: { ...feature, properties: { display_name: '59,91270° N, 10,74460° Ø' } },
      featureNote: 'Kunne ikke hente adressen for punktet. Adressetjenesten svarer ikke.',
      onRetryFeature
    });
    const card = screen.getByRole('region', { name: 'Detaljer' });
    expect(within(card).getByRole('heading', { level: 2, name: '59,91270° N, 10,74460° Ø' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Kopier' })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Prøv igjen' }));
    expect(onRetryFeature).toHaveBeenCalledTimes(1);
  });

  it('folds its facts while it shares the rail with a list, and unfolds them on demand', () => {
    const pharmacy: GeoJSONFeature = {
      ...feature,
      properties: {
        display_name: 'Vitusapotek Jernbanetorget, 4, Jernbanetorget, Oslo, 0154, Norge',
        name: 'Vitusapotek Jernbanetorget',
        address: { road: 'Jernbanetorget', house_number: '4', postcode: '0154', city: 'Oslo' }
      }
    };
    renderSideBar({ feature: pharmacy, compact: true });
    const card = screen.getByRole('region', { name: 'Detaljer' });

    // What names the place and what can be done with it stay; the facts fold.
    expect(within(card).getByRole('heading', { level: 2, name: 'Vitusapotek Jernbanetorget' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Veibeskrivelse hit' })).toBeInTheDocument();
    expect(within(card).queryByText('Adresse')).toBeNull();

    const disclosure = within(card).getByRole('button', { name: 'Vis detaljer' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);
    expect(within(card).getByText('Adresse')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Skjul detaljer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the whole card when nothing else needs the rail', () => {
    renderSideBar({
      feature: {
        ...feature,
        properties: {
          display_name: '12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge',
          address: { road: 'Storgata', house_number: '12', postcode: '0184', city: 'Oslo' }
        }
      }
    });
    const card = screen.getByRole('region', { name: 'Detaljer' });
    expect(within(card).queryByRole('button', { name: 'Vis detaljer' })).toBeNull();
    expect(within(card).getByText('0184 Oslo')).toBeInTheDocument();
  });

  it('puts the directions right under the name, before the facts', () => {
    renderSideBar({
      feature: {
        ...feature,
        properties: {
          display_name: 'Kaffebrenneriet, 12, Storgata, Sentrum, Gamle Oslo, Oslo, 0184, Norge',
          name: 'Kaffebrenneriet',
          address: { road: 'Storgata', house_number: '12', postcode: '0184', city: 'Oslo' }
        }
      }
    });
    const card = screen.getByRole('region', { name: 'Detaljer' });
    const directions = within(card).getByRole('group', { name: 'Veibeskrivelse' });
    expect(follows(within(card).getByRole('heading', { level: 2 }), directions)).toBe(true);
    expect(follows(directions, within(card).getByText('Adresse'))).toBe(true);
  });
});
