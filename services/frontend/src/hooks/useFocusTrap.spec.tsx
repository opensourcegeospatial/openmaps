import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

afterEach(cleanup);

interface DialogProps {
  onEscape: () => void;
}

const Dialog: React.FC<DialogProps> = ({ onEscape }) => {
  const ref = useFocusTrap<HTMLDivElement>({ active: true, onEscape });
  return (
    <div ref={ref} role="dialog" aria-label="test">
      <button>first</button>
      <button>second</button>
      <button>third</button>
    </div>
  );
};

const Host: React.FC = () => {
  const [open, setOpen] = useState(false);
  const onEscape = () => setOpen(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      {open && <Dialog onEscape={onEscape} />}
    </div>
  );
};

/**
 * A dialog whose first controls are a roving-tabindex group, as the layer
 * manager's tabs are: only one of the three can be focused at a time.
 */
const RovingDialog: React.FC = () => {
  const ref = useFocusTrap<HTMLDivElement>({ active: true });
  return (
    <div ref={ref} role="dialog" aria-label="roving">
      <button tabIndex={0}>tab one</button>
      <button tabIndex={-1}>tab two</button>
      <button tabIndex={-1}>tab three</button>
      <button>close</button>
    </div>
  );
};

describe('useFocusTrap with a roving-tabindex group', () => {
  it('wraps from the last element the browser can actually focus', () => {
    vi.useFakeTimers();
    render(<RovingDialog />);
    act(() => {
      vi.runAllTimers();
    });
    // The untabbable tabs are not stops: the group counts once.
    expect(document.activeElement).toBe(screen.getByText('tab one'));

    screen.getByText('close').focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('tab one'));
    vi.useRealTimers();
  });

  it('wraps backward to that same last element', () => {
    vi.useFakeTimers();
    render(<RovingDialog />);
    act(() => {
      vi.runAllTimers();
    });
    screen.getByText('tab one').focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('close'));
    vi.useRealTimers();
  });
});

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element on open', () => {
    vi.useFakeTimers();
    render(<Host />);
    fireEvent.click(screen.getByText('open'));
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(screen.getByText('first'));
    vi.useRealTimers();
  });

  it('wraps focus forward on Tab from the last element', () => {
    vi.useFakeTimers();
    render(<Host />);
    fireEvent.click(screen.getByText('open'));
    act(() => {
      vi.runAllTimers();
    });

    const last = screen.getByText('third');
    last.focus();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('first'));
    vi.useRealTimers();
  });

  it('wraps focus backward on Shift+Tab from the first element', () => {
    vi.useFakeTimers();
    render(<Host />);
    fireEvent.click(screen.getByText('open'));
    act(() => {
      vi.runAllTimers();
    });

    const first = screen.getByText('first');
    first.focus();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('third'));
    vi.useRealTimers();
  });

  it('calls onEscape and restores focus to the trigger on close', () => {
    vi.useFakeTimers();
    render(<Host />);
    const trigger = screen.getByText('open');
    // Simulate the real-browser behaviour where clicking focuses the trigger.
    trigger.focus();
    fireEvent.click(trigger);
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(screen.getByText('first'));

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    // Host closes the dialog in response to onEscape; focus should return to trigger.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
    vi.useRealTimers();
  });
});
