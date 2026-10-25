import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ToastProvider } from './ToastProvider';
import { useToast } from './useToast';
import { useModalPresence } from '../../hooks/useModalPresence';
import { useInlineUndo } from './useInlineUndo';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Test harness exposing buttons that fire each toast variant. */
const Harness: React.FC = () => {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.error('Noe gikk galt')}>err</button>
      <button onClick={() => toast.success('Lagret')}>ok</button>
      <button onClick={() => toast.info('Til info')}>info</button>
      <button onClick={() => toast.info('Første er fjernet', { id: 'a', subject: 'sted', action: { label: 'Angre', onClick: () => {} } })}>undo1</button>
      <button onClick={() => toast.info('Andre er fjernet', { id: 'b', subject: 'sted', action: { label: 'Angre', onClick: () => {} } })}>undo2</button>
      <button onClick={() => toast.info('Treffene er fjernet', { id: 'treff', action: { label: 'Angre', onClick: () => {} } })}>undo3</button>
      <button onClick={() => toast.info('Tredje er fjernet', { id: 'c', subject: 'sted', inline: true, action: { label: 'Angre', onClick: () => {} } })}>inline-undo</button>
    </div>
  );
};

const renderHarness = () =>
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );

/** A stand-in modal: registers itself as open while mounted. */
const Modal: React.FC = () => {
  useModalPresence();
  return <div role="dialog" aria-modal="true" aria-label="Kartlag" />;
};

const ModalHarness: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  return (
    <ToastProvider>
      <Harness />
      <button onClick={() => setOpen((v) => !v)}>modal</button>
      {open && <Modal />}
    </ToastProvider>
  );
};

describe('useToast', () => {
  it('throws when used outside a ToastProvider', () => {
    const Boom: React.FC = () => {
      useToast();
      return null;
    };
    // Silence the expected error boundary log.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Boom />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

describe('ToastProvider', () => {
  it('renders an error toast inside an assertive alert region', () => {
    renderHarness();
    fireEvent.click(screen.getByText('err'));

    expect(screen.getByText('Noe gikk galt')).toBeInTheDocument();
    const alertRegion = screen.getByRole('alert');
    expect(alertRegion).toHaveAttribute('aria-live', 'assertive');
    expect(alertRegion).toHaveTextContent('Noe gikk galt');
  });

  it('stacks multiple toasts', () => {
    renderHarness();
    fireEvent.click(screen.getByText('err'));
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('info'));

    expect(screen.getByText('Noe gikk galt')).toBeInTheDocument();
    expect(screen.getByText('Lagret')).toBeInTheDocument();
    expect(screen.getByText('Til info')).toBeInTheDocument();
  });

  it('dismisses a toast via the "Lukk varsel" button', () => {
    renderHarness();
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByText('Lagret')).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button', { name: 'Lukk varsel' });
    fireEvent.click(closeButtons[0]);
    expect(screen.queryByText('Lagret')).not.toBeInTheDocument();
  });

  // Focus paused nothing while the pause lived in a ref, and a focused toast
  // that was removed left the stack "in use" for good (critique run 12).
  it('pauses while focus is inside the stack, and restarts once it leaves', () => {
    vi.useFakeTimers();
    renderHarness();
    fireEvent.click(screen.getByText('ok'));
    act(() => screen.getByRole('button', { name: 'Lukk varsel' }).focus());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Lagret')).toBeInTheDocument();

    act(() => screen.getByText('info').focus());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByText('Lagret')).not.toBeInTheDocument();
  });

  it('keeps timing later toasts after the focused one is removed', () => {
    vi.useFakeTimers();
    renderHarness();
    fireEvent.click(screen.getByText('ok'));
    const close = screen.getByRole('button', { name: 'Lukk varsel' });
    act(() => close.focus());
    fireEvent.click(close);
    expect(screen.queryByText('Lagret')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('info'));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByText('Til info')).not.toBeInTheDocument();
  });

  // Eight seconds could not be met from the keyboard, 7–10 Tab presses away,
  // so an undo waits (critique run 13); a newer one replaces only an undo
  // about the same thing, and says the old one is gone (critique run 14).
  it('keeps an undo until it is used or closed; a newer one about the same thing replaces it, and says so', () => {
    vi.useFakeTimers();
    renderHarness();
    fireEvent.click(screen.getByText('undo1'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Første er fjernet')).toBeInTheDocument();

    fireEvent.click(screen.getByText('undo2'));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByText('Første er fjernet')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Angre' })).toHaveLength(1);
    expect(screen.getByText('Kan ikke lenger angres: Første er fjernet')).toBeInTheDocument();
  });

  // One undo for everything threw away an area answer's undo, a minute of
  // work, for a star click (critique run 14).
  it('lets undos about different things wait side by side', () => {
    renderHarness();
    fireEvent.click(screen.getByText('undo3'));
    fireEvent.click(screen.getByText('undo1'));
    expect(screen.getAllByRole('button', { name: 'Angre' })).toHaveLength(2);
    expect(screen.getByText('Treffene er fjernet')).toBeInTheDocument();
  });

  it('describes each Angre by its message', () => {
    renderHarness();
    fireEvent.click(screen.getByText('undo1'));
    expect(screen.getByRole('button', { name: 'Angre' })).toHaveAccessibleDescription('Første er fjernet');
  });

  it('closes on Escape inside it, and keeps the Escape from the app behind', () => {
    renderHarness();
    let seenByApp = false;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) seenByApp = true;
    };
    window.addEventListener('keydown', listener);
    fireEvent.click(screen.getByText('undo1'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Angre' }), { key: 'Escape' });
    window.removeEventListener('keydown', listener);
    expect(screen.queryByText('Første er fjernet')).not.toBeInTheDocument();
    expect(seenByApp).toBe(false);
  });

  // A timed toast and an undo looked alike, though one runs out and the other
  // waits (critique run 14).
  it('shows a countdown line on a timed toast and none on an undo', () => {
    renderHarness();
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('undo3'));
    const timed = screen.getByText('Lagret').closest('[data-toast-id]') as HTMLElement;
    const undo = screen.getByText('Treffene er fjernet').closest('[data-toast-id]') as HTMLElement;
    expect(timed.querySelector('.toast-countdown')).not.toBeNull();
    expect(undo.querySelector('.toast-countdown')).toBeNull();
  });

  // Under the Kartlag dialog a warning ran out unseen behind the scrim, and
  // the stack stayed reachable behind a modal (critique run 14).
  it('holds its timers and goes inert while a modal is open', () => {
    vi.useFakeTimers();
    render(<ModalHarness />);
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('modal'));
    const stack = screen.getByText('Lagret').closest('.toast-stack') as HTMLElement;
    expect(stack.hasAttribute('inert')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByText('Lagret')).toBeInTheDocument();

    fireEvent.click(screen.getByText('modal'));
    expect(stack.hasAttribute('inert')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByText('Lagret')).not.toBeInTheDocument();
  });

  // Inert, the stack is out of the accessibility tree, and it comes back when
  // the dialog closes as regions created with their content, which screen
  // readers do not read: a warning raised under Kartlag was never heard
  // (polish, critique run 14). Without a modal the stack speaks for itself,
  // and nothing beside it repeats it.
  it('announces what arrives under a modal beside the inert stack, and only then', () => {
    vi.useFakeTimers();
    render(<ModalHarness />);
    const stack = document.querySelector('.toast-stack') as HTMLElement;
    const besideStack = (text: string) => screen.queryAllByText(text).filter((el) => !stack.contains(el));

    fireEvent.click(screen.getByText('ok'));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(besideStack('Lagret')).toHaveLength(0);

    fireEvent.click(screen.getByText('modal'));
    fireEvent.click(screen.getByText('info'));
    fireEvent.click(screen.getByText('err'));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const [polite] = besideStack('Til info');
    const [assertive] = besideStack('Noe gikk galt');
    expect(polite).toBeInstanceOf(HTMLElement);
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(assertive).toBeInstanceOf(HTMLElement);
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
  });

  // An undo shown where the removed thing was is not in the stack, but every
  // rule about it still lives here (critique run 15).
  it('keeps an undo marked `inline` out of the stack, and hands it to its surface', () => {
    const Host: React.FC = () => {
      const undo = useInlineUndo('sted');
      return <div data-testid="host">{undo ? `${undo.message} · ${undo.action.label}` : 'tomt'}</div>;
    };
    render(
      <ToastProvider>
        <Harness />
        <Host />
      </ToastProvider>
    );
    expect(screen.getByTestId('host')).toHaveTextContent('tomt');

    fireEvent.click(screen.getByText('inline-undo'));
    const stack = document.querySelector('.toast-stack') as HTMLElement;
    expect(stack.querySelectorAll('[data-toast-id]')).toHaveLength(0);
    expect(screen.getByTestId('host')).toHaveTextContent('Tredje er fjernet · Angre');

    // One undo per subject spans both forms: a newer one about the same thing
    // replaces it wherever either is shown.
    fireEvent.click(screen.getByText('undo1'));
    expect(screen.getByTestId('host')).toHaveTextContent('tomt');
    expect(stack).toHaveTextContent('Første er fjernet');
    expect(screen.getAllByRole('button', { name: 'Angre' })).toHaveLength(1);
  });

  it('auto-dismisses after the timeout elapses', () => {
    vi.useFakeTimers();
    renderHarness();
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByText('Lagret')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByText('Lagret')).not.toBeInTheDocument();
  });
});
