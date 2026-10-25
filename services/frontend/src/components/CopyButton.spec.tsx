import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import CopyButton from './CopyButton';
import { copyText } from '../lib/clipboard';

vi.mock('../lib/clipboard', () => ({ copyText: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const WEBSITE = 'https://kaffebrenneriet.no';

const Row = () => {
  const valueRef = useRef<HTMLSpanElement>(null);
  return (
    <p>
      <span ref={valueRef}>{WEBSITE}</span>
      <CopyButton text={WEBSITE} selectRef={valueRef} />
    </p>
  );
};

describe('CopyButton', () => {
  it('confirms a copy in its own label', async () => {
    vi.mocked(copyText).mockResolvedValue(true);
    render(<Row />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kopier' }));
    });
    expect(screen.getByRole('button', { name: 'Kopiert' })).toBeInTheDocument();
  });

  it('when the browser refuses, selects the text and names the keys that copy it', async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    render(<Row />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kopier' }));
    });
    expect(screen.getByRole('button', { name: /^Merket, trykk (Ctrl\+C|⌘C)$/ })).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe(WEBSITE);
  });
});
