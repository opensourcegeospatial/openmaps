import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ElevationProfile, { alongLabel } from './ElevationProfile';
import type { ElevationProfileData } from '../lib/routeDetails';

afterEach(cleanup);

const profile: ElevationProfileData = {
  points: [
    { at: 0, height: 20 },
    { at: 600, height: 30 },
    { at: 1200, height: 41 }
  ],
  min: 20,
  max: 41,
  ascend: 23,
  descend: 2,
  length: 1200
};

const plain = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ');

describe('ElevationProfile', () => {
  it('shows climb, descent and the height range', () => {
    render(<ElevationProfile profile={profile} position={null} onPosition={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Høydeprofil' })).toBeInTheDocument();
    expect(plain(screen.getByText(/^Stigning/).textContent)).toBe('Stigning 23 m · Fall 2 m');
    expect(screen.getByText('41 moh.')).toBeInTheDocument();
    expect(screen.getByText('20 moh.')).toBeInTheDocument();
  });

  it('is a slider named Høydeprofil whose value reads distance and height', () => {
    render(<ElevationProfile profile={profile} position={600} onPosition={vi.fn()} />);
    const slider = screen.getByRole('slider', { name: 'Høydeprofil' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '1200');
    expect(slider).toHaveAttribute('aria-valuenow', '600');
    expect(plain(slider.getAttribute('aria-valuetext'))).toBe('600 m, 30 moh.');
  });

  it('moves by 1 % with arrows, 10 % with PageUp/PageDown, and to the ends with Home/End', () => {
    const onPosition = vi.fn();
    render(<ElevationProfile profile={profile} position={600} onPosition={onPosition} />);
    const slider = screen.getByRole('slider', { name: 'Høydeprofil' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'PageUp' });
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onPosition.mock.calls.map(([m]) => Math.round(m))).toEqual([612, 588, 720, 0, 1200]);
  });

  it('starts at the beginning on focus and lets go on blur', () => {
    const onPosition = vi.fn();
    render(<ElevationProfile profile={profile} position={null} onPosition={onPosition} />);
    const slider = screen.getByRole('slider', { name: 'Høydeprofil' });
    fireEvent.focus(slider);
    fireEvent.blur(slider);
    expect(onPosition.mock.calls).toEqual([[0], [null]]);
  });

  it('says distances as a reader says them', () => {
    expect(alongLabel(0)).toBe('0 m');
    expect(plain(alongLabel(850))).toBe('850 m');
    expect(plain(alongLabel(1600))).toBe('1,6 km');
  });

  it('scrubs by touch: pointerDown sets position from client coordinates', () => {
    const onPosition = vi.fn();
    render(<ElevationProfile profile={profile} position={null} onPosition={onPosition} />);
    const slider = screen.getByRole('slider', { name: 'Høydeprofil' }) as HTMLDivElement;
    // Stub getBoundingClientRect: width=200, so clientX=100 is halfway.
    const originalGetBoundingClientRect = slider.getBoundingClientRect.bind(slider);
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      width: 200,
      top: 0,
      height: 60,
      right: 200,
      bottom: 60,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect));
    try {
      // Create an event object with clientX, and fire it directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventInit = { pointerId: 1, clientX: 100, bubbles: true, cancelable: true } as any;
      const event = new MouseEvent('pointerdown', eventInit);
      // Manually set clientX on the event (some properties may be read-only, so use Object.defineProperty if needed)
      Object.defineProperty(event, 'clientX', { value: 100, writable: false });
      slider.dispatchEvent(event);
      // At clientX=100 with width=200, position = (100 / 200) * 1200 = 600.
      expect(onPosition).toHaveBeenCalledWith(expect.closeTo(600, 1));
    } finally {
      slider.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it('a press on the unfocused slider stays where it lands (pointerDown then focus)', () => {
    const onPosition = vi.fn();
    render(<ElevationProfile profile={profile} position={null} onPosition={onPosition} />);
    const slider = screen.getByRole('slider', { name: 'Høydeprofil' }) as HTMLDivElement;
    // Stub getBoundingClientRect: width=200, so clientX=100 is halfway.
    const originalGetBoundingClientRect = slider.getBoundingClientRect.bind(slider);
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      width: 200,
      top: 0,
      height: 60,
      right: 200,
      bottom: 60,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect));
    try {
      // Simulate a press: pointerdown sets position to ~600, then focus fires.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventInit = { pointerId: 1, clientX: 100, bubbles: true, cancelable: true } as any;
      const event = new MouseEvent('pointerdown', eventInit);
      Object.defineProperty(event, 'clientX', { value: 100, writable: false });
      slider.dispatchEvent(event);
      // Now focus (as would happen on a real pointer press on an unfocused element).
      fireEvent.focus(slider);
      // The slider should stay at ~600, not jump back to 0. onPosition should be called only once.
      expect(onPosition.mock.calls.map(([m]) => Math.round(m))).toEqual([600]);
    } finally {
      slider.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });
});
