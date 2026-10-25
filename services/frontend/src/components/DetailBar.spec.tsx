import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DetailBar from './DetailBar';
import type { DetailShare } from '../lib/routeDetails';
import { UNKNOWN_LABEL } from '../lib/routeDetailLabels';

afterEach(cleanup);

const shares: DetailShare[] = [
  { id: 'Asfalt', label: 'Asfalt', metres: 800, share: 80, values: ['asphalt'] },
  { id: 'Grus', label: 'Grus', metres: 200, share: 20, values: ['gravel'] }
];

const renderBar = (props: Partial<Parameters<typeof DetailBar>[0]> = {}) =>
  render(
    <DetailBar title="Underlag" shares={shares} activeId={null} pinnedId={null} onPreview={vi.fn()} onTogglePin={vi.fn()} {...props} />
  );

describe('DetailBar', () => {
  it('names every category with its share, as buttons under a heading', () => {
    renderBar();
    expect(screen.getByRole('heading', { name: 'Underlag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Asfalt 80 %' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Grus 20 %' })).toBeInTheDocument();
  });

  it('previews on hover and focus, and stops on leave and blur', () => {
    const onPreview = vi.fn();
    renderBar({ onPreview });
    const grus = screen.getByRole('button', { name: 'Grus 20 %' });
    fireEvent.mouseEnter(grus);
    fireEvent.mouseLeave(grus);
    fireEvent.focus(grus);
    fireEvent.blur(grus);
    expect(onPreview.mock.calls).toEqual([['Grus'], [null], ['Grus'], [null]]);
  });

  it('pins on press and says so', () => {
    const onTogglePin = vi.fn();
    renderBar({ onTogglePin, pinnedId: 'Grus', activeId: 'Grus' });
    const grus = screen.getByRole('button', { name: 'Grus 20 %' });
    expect(grus).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(grus);
    expect(onTogglePin).toHaveBeenCalledWith('Grus');
  });

  it('renders nothing without shares', () => {
    const { container } = renderBar({ shares: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('ranks the darkest tone among known shares only, not Ukjent', () => {
    const sharesWithUnknown: DetailShare[] = [
      { id: UNKNOWN_LABEL, label: 'Ukjent', metres: 500, share: 50, values: [null] },
      { id: 'Asfalt', label: 'Asfalt', metres: 300, share: 30, values: ['asphalt'] },
      { id: 'Grus', label: 'Grus', metres: 200, share: 20, values: ['gravel'] }
    ];
    renderBar({ shares: sharesWithUnknown });

    const asfaltButton = screen.getByRole('button', { name: 'Asfalt 30 %' });
    const grusButton = screen.getByRole('button', { name: 'Grus 20 %' });
    const ukjentButton = screen.getByRole('button', { name: 'Ukjent 50 %' });

    // Get the color swatches (first span child in each button with aria-hidden)
    const asfaltSwatch = asfaltButton.querySelector('span[aria-hidden="true"]') as HTMLElement;
    const grusSwatch = grusButton.querySelector('span[aria-hidden="true"]') as HTMLElement;
    const ukjentSwatch = ukjentButton.querySelector('span[aria-hidden="true"]') as HTMLElement;

    // Asfalt is the first known share, so it gets the darkest tone (--detail-ramp-1)
    expect(asfaltSwatch.getAttribute('style')).toBe('background: var(--detail-ramp-1);');
    // Grus is the second known share, so it gets --detail-ramp-2
    expect(grusSwatch.getAttribute('style')).toBe('background: var(--detail-ramp-2);');
    // Ukjent is always hatched
    expect(ukjentSwatch.getAttribute('style')).toBe('background: var(--detail-unknown);');
  });
});
