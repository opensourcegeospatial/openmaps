import { describe, it, expect } from 'vitest';
import { finalizeMeasurementPoints } from './measure';

const p = (lat: number, lng: number) => ({ lat, lng });

describe('finalizeMeasurementPoints', () => {
  it('drops the duplicate vertex the second click of a double-click adds', () => {
    expect(finalizeMeasurementPoints([p(1, 1), p(2, 2), p(2, 2)])).toEqual([p(1, 1), p(2, 2)]);
  });

  it('keeps a sequence without a trailing duplicate unchanged', () => {
    expect(finalizeMeasurementPoints([p(1, 1), p(2, 2)])).toEqual([p(1, 1), p(2, 2)]);
  });

  it('only removes one trailing duplicate, never an intentional revisit', () => {
    expect(finalizeMeasurementPoints([p(1, 1), p(1, 1), p(1, 1)])).toEqual([p(1, 1), p(1, 1)]);
  });
});
