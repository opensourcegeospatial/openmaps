import { describe, it, expect } from 'vitest';
import { plainAttribution } from './attribution';

describe('plainAttribution', () => {
  it('keeps the credit but drops the link', () => {
    expect(
      plainAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors')
    ).toBe('&copy; OpenStreetMap contributors');
  });

  it('leaves text without links untouched', () => {
    expect(plainAttribution('Lokale OpenStreetMap-data')).toBe('Lokale OpenStreetMap-data');
  });

  it('flattens several links and collapses the whitespace around them', () => {
    expect(
      plainAttribution('<a href="a">Kartverket</a>  |  <a href="b" target="_blank">Geovekst</a>')
    ).toBe('Kartverket | Geovekst');
  });
});
