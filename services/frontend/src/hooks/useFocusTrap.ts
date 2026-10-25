import React, { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  // `offsetParent` is the cheapest real-browser visibility signal, but jsdom
  // always reports null, so only treat null as hidden when the browser also
  // exposes layout (offsetWidth/Height). This keeps the trap usable in tests.
  const hasLayout = el.offsetWidth > 0 || el.offsetHeight > 0;
  if (hasLayout && el.offsetParent === null) return false;
  return true;
}

/**
 * Only genuinely tabbable elements count. A roving-tabindex group (the layer
 * manager's three tabs) is one stop, not three, and an element the browser
 * will never focus must never be the trap's last stop: while it was, the
 * "wrap at the end" branch never fired and Tab walked out of the dialog
 * altogether (critique run 7).
 */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.tabIndex >= 0)
    .filter(isVisible);
}

export interface UseFocusTrapOptions {
  /** Whether the trap is active (e.g. the dialog is open). */
  active: boolean;
  /** Called when the user presses Escape inside the trap. */
  onEscape?: () => void;
  /**
   * Optional element to focus first. When omitted, the first focusable element
   * inside the container is focused (falling back to the container itself).
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Focus-management primitive for modal dialogs / overlays.
 *
 * While `active`:
 * - Moves focus into the container on open (first focusable, an explicit
 *   `initialFocusRef`, or the container itself).
 * - Traps Tab / Shift+Tab within the container (wrapping at the ends).
 * - Calls `onEscape` when Escape is pressed.
 * - Restores focus to the element that was focused before opening, on close.
 *
 * Returns a ref to attach to the dialog container element.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  options: UseFocusTrapOptions
): React.RefObject<T> {
  const { active, onEscape, initialFocusRef } = options;
  const containerRef = useRef<T>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Remember what had focus so we can restore it on close.
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus into the dialog.
    const target =
      initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
    if (target === container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }
    // Defer so the element is laid out/visible before focusing.
    const focusHandle = window.setTimeout(() => target.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        // Keep focus on the container so it never escapes the dialog.
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;

      if (event.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        event.preventDefault();
        first.focus();
      }
    };

    // On the document, not the container: when the focused element is removed
    // (the tab switch after adding a layer), focus falls to <body> and a
    // container listener would stop hearing Escape and Tab.
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusHandle);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the trigger element on close.
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return containerRef;
}

export default useFocusTrap;
