import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { OSM_CREDIT } from './attribution';
import { defaultMapStyles } from './mapStyles';

describe('defaultMapStyles', () => {
  it('only offers same-origin tile sources by default', () => {
    for (const style of defaultMapStyles) {
      expect(style.url, style.id).toMatch(/^\//);
    }
  });

  it('keeps the local tile server as the first entry', () => {
    expect(defaultMapStyles[0]?.id).toBe('local');
  });

  it('credits the OpenStreetMap contributors in Norwegian', () => {
    expect(OSM_CREDIT).toBe('© OpenStreetMap-bidragsytere');
    expect(defaultMapStyles[0]?.attribution).toBe(OSM_CREDIT);
  });
});

describe('static/config.json map styles', () => {
  const config = JSON.parse(
    readFileSync(resolve(__dirname, '../../static/config.json'), 'utf-8')
  ) as { styles: { id: string; attribution?: string }[] };
  const credit = (id: string) => config.styles.find((s) => s.id === id)?.attribution;

  it('credits each provider as its terms ask, in Norwegian', () => {
    expect(credit('osm')).toBe(
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsytere'
    );
    expect(credit('local')).toBe(OSM_CREDIT);
    expect(credit('satellite')).toBe(
      'Kilde: Esri, Maxar, Earthstar Geographics og GIS-brukerfellesskapet'
    );
    expect(credit('topo')).toBe(
      'Kartdata: © OpenStreetMap-bidragsytere, SRTM · Kartvisning: © OpenTopoMap (CC-BY-SA)'
    );
    expect(credit('stamen-terrain')).toBe(
      '© Stadia Maps © Stamen Design © OpenMapTiles © OpenStreetMap-bidragsytere'
    );
    expect(credit('cartodb-light')).toBe('© OpenStreetMap-bidragsytere © CARTO');
    expect(credit('cartodb-dark')).toBe('© OpenStreetMap-bidragsytere © CARTO');
  });

  it('has no English "contributors" credit left', () => {
    for (const style of config.styles) {
      expect(style.attribution, style.id).not.toMatch(/contributors/i);
    }
  });
});
