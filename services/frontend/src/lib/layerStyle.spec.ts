import { describe, it, expect } from 'vitest';
import { resolveFileLayerColors } from './layerStyle';

const FALLBACK = '#c83719';

describe('resolveFileLayerColors', () => {
  it('uses the chosen color for both stroke and fill', () => {
    expect(resolveFileLayerColors({ color: '#00ff00', fillColor: '#00ff00' }, FALLBACK)).toEqual({
      color: '#00ff00',
      fillColor: '#00ff00'
    });
  });

  it('honors a distinct fillColor', () => {
    expect(resolveFileLayerColors({ color: '#00ff00', fillColor: '#0000ff' }, FALLBACK)).toEqual({
      color: '#00ff00',
      fillColor: '#0000ff'
    });
  });

  it('falls back fillColor to color when only color is set', () => {
    expect(resolveFileLayerColors({ color: '#00ff00' }, FALLBACK)).toEqual({
      color: '#00ff00',
      fillColor: '#00ff00'
    });
  });

  it('falls back to the default when style is undefined or empty', () => {
    expect(resolveFileLayerColors(undefined, FALLBACK)).toEqual({ color: FALLBACK, fillColor: FALLBACK });
    expect(resolveFileLayerColors({}, FALLBACK)).toEqual({ color: FALLBACK, fillColor: FALLBACK });
  });
});
