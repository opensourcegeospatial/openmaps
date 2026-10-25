import { useEffect, useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * Whether a modal dialog is open anywhere in the app.
 *
 * A modal registers while it is mounted (`useModalPresence()`); whatever must
 * step back behind a modal reads `useModalOpen()`. The toast stack does: under
 * the Kartlag dialog it sits beneath the scrim, leaves the keyboard and the
 * screen reader alone, and stops its timers, so a warning raised meanwhile is
 * still there when the dialog closes (critique run 14). One signal drives all
 * three, so they cannot disagree.
 *
 * A counter, not a flag: two modals can overlap without the first to close
 * clearing the second.
 */
let openModals = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Register the calling modal as open for as long as `active` holds. */
export function useModalPresence(active = true): void {
  useEffect(() => {
    if (!active) return;
    openModals += 1;
    emit();
    return () => {
      openModals -= 1;
      emit();
    };
  }, [active]);
}

/**
 * Everything outside `ref` steps back while the modal is open: every sibling
 * on the way up to the page root goes inert, so the pointer, the keyboard and
 * the screen reader all stay with the dialog. `aria-modal` alone only asks
 * assistive technology to do that, and the page behind stayed in the
 * accessibility tree — with the Kartlag dialog open, the area answer behind it
 * was still readable there (critique run 15).
 *
 * A layout effect, so the attribute comes off before the focus trap's own
 * cleanup hands focus back to the trigger: an inert element cannot take focus.
 *
 * Two limits, both deliberate: the toast layer is left alone, because it steps
 * back on its own terms (the stack inert, its announcer regions still live, so
 * a warning raised meanwhile is still heard — see ToastProvider); and siblings
 * that appear while the dialog is open are not caught, which nothing in this
 * app can do from inside a modal.
 */
export function useInertOutside(ref: RefObject<HTMLElement | null>, active = true): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const marked: HTMLElement[] = [];
    for (let el: HTMLElement | null = node; el && el !== document.body; el = el.parentElement) {
      for (const sibling of Array.from(el.parentElement?.children ?? [])) {
        if (sibling === el || !(sibling instanceof HTMLElement)) continue;
        if (sibling.hasAttribute('inert') || sibling.hasAttribute('data-toast-layer')) continue;
        sibling.setAttribute('inert', '');
        marked.push(sibling);
      }
    }
    return () => {
      marked.forEach((el) => el.removeAttribute('inert'));
    };
  }, [ref, active]);
}

/** Whether any modal is open right now. */
export function useModalOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => openModals > 0,
    () => false
  );
}
