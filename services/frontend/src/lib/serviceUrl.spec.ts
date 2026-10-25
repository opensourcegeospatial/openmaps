import { describe, it, expect } from 'vitest';
import { resolveServiceUrl } from './serviceUrl';

describe('resolveServiceUrl', () => {
  it('keeps absolute URLs', () => {
    expect(resolveServiceUrl('https://kart.example.no/geoserver/wms?x=1').href).toBe(
      'https://kart.example.no/geoserver/wms?x=1'
    );
  });

  it('resolves a relative path against the page origin (internal services behind the proxy)', () => {
    const url = resolveServiceUrl('/geoserver/wms');
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/geoserver/wms');
  });

  it('rejects garbage with a Norwegian message', () => {
    expect(() => resolveServiceUrl('http://[bad')).toThrow('Ugyldig tjeneste-URL');
    expect(() => resolveServiceUrl('   ')).toThrow('Ugyldig tjeneste-URL');
  });
});
