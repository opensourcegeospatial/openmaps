import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@mattilsynet/design/react';
import { useModalOpen } from '../../hooks/useModalPresence';
import {
  ToastContext,
  InlineUndoContext,
  type ToastApi,
  type ToastItem,
  type ToastOptions,
  type ToastVariant
} from './toast-context';

/** Default auto-dismiss timeouts (ms) per variant. Errors linger longer. */
const DEFAULT_TIMEOUTS: Record<ToastVariant, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  danger: 8000
};

type AlertColor = React.ComponentProps<typeof Alert>['data-color'];

// A toast carrying an action (an undo) has no timer at all: it stays until it
// is used, closed, replaced by a newer undo about the same subject, or
// withdrawn because what it would restore is gone. Eight seconds could not be
// met from the keyboard, where Angre sat 7–10 Tab presses from the action
// (WCAG 2.2.1; critique run 13).

// A toast's buttons sit on the first line of its message. The design-system
// Alert spaces its children as stacked blocks, 1em apart (`> * + *`), which in
// this one-row toast dropped "Angre" and the close button 16px below the line
// they belong to.
const TOAST_BUTTON: React.CSSProperties = {
  flexShrink: 0,
  margin: 0,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: 'inherit'
};

let counter = 0;
const nextId = () => `toast-${Date.now()}-${counter++}`;
let seqCounter = 0;

interface ToastRowProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  /** Hold the timer: focus is in the stack, or a modal is open. */
  paused: boolean;
}

/**
 * A single toast. Owns its own auto-dismiss timer so re-renders of sibling
 * toasts don't reset it. The timer is held while focus is anywhere in the
 * stack or a modal is open (`paused`, from the provider) and while the pointer
 * rests on this toast, so there is time to read it and to reach its action;
 * held, it starts over in full.
 */
const ToastRow: React.FC<ToastRowProps> = ({ toast, onDismiss, paused }) => {
  const dismiss = useCallback(() => onDismiss(toast.id), [onDismiss, toast.id]);
  // The hover pause belongs to the row, not the stack: a toast removed from
  // under the pointer gets no mouseleave (just as a focused one removed gets
  // no blur), and a stack-wide flag would then freeze every later toast.
  const [hovered, setHovered] = useState(false);
  const running = toast.timeout !== false && !paused && !hovered;
  const timeout = running ? toast.timeout : false;

  useEffect(() => {
    if (timeout === false) return;
    const handle = window.setTimeout(dismiss, timeout);
    return () => window.clearTimeout(handle);
  }, [dismiss, timeout, toast.seq]);

  // The provider hands focus back as the toast goes (see `release`), and an
  // action that puts focus onto what it restored runs after that and wins.
  const close = (run?: () => void) => {
    run?.();
    dismiss();
  };
  // Every undo button is called "Angre"; its message is what tells them apart.
  const messageId = React.useId();

  return (
    <Alert
      // Information is not a selection: it takes the brand's main scale (Lichen
      // Tint, with the design system's default "i" icon), never Survey Blue. The
      // design system's CSS accepts every colour scale here; its Alert type lists
      // only five, so main is passed through a cast (checked in both schemes).
      data-color={(toast.variant === 'info' ? 'main' : toast.variant) as AlertColor}
      data-toast-id={toast.id}
      // Escape inside a toast closes the toast, not the panel behind it: the
      // app's own Escape handler skips an event already handled.
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5rem',
        maxWidth: '24rem',
        // Body role (16px), like the panels: the design-system Alert would
        // otherwise size itself at the 18px page base and outrank the copy
        // it comments on.
        fontSize: 'var(--mtds-font-size-3)',
        lineHeight: 1.5,
        // Room for the countdown line along the foot, inside the corners.
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <span id={messageId} style={{ flex: 1 }}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
          onClick={() => close(toast.action?.onClick)}
          aria-describedby={messageId}
          style={{
            ...TOAST_BUTTON,
            font: 'inherit',
            fontWeight: 500,
            textDecoration: 'underline',
            padding: '0 0.25rem'
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
        onClick={() => close()}
        aria-label="Lukk varsel"
        style={{
          ...TOAST_BUTTON,
          display: 'inline-flex',
          lineHeight: 1,
          padding: '0.125rem'
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* A timed toast shows its time: a line along its foot runs down with
          the timer, and stands full while it is held (the timer then starts
          over in full, and so does the line). An undo has no timer and no
          line, which is how it reads as something that waits; the two looked
          alike before (critique run 14). Last in the toast: the Alert lays
          out its icon against its first child, and put first, the line
          pushed the message onto a row of its own. */}
      {toast.timeout !== false && (
        <span
          aria-hidden="true"
          key={`${toast.seq}-${running ? 'running' : 'held'}`}
          className={`toast-countdown${running ? '' : ' is-held'}`}
          style={{ animationDuration: `${toast.timeout}ms` }}
        />
      )}
    </Alert>
  );
};

interface ToastProviderProps {
  children: React.ReactNode;
}

/**
 * Provides the imperative toast API via context, renders the toast stack, and
 * hands the undos marked `inline` to the surfaces that show them in the place
 * the removed thing had (see UndoNotice).
 *
 * Accessibility:
 * - Non-error toasts live in an `aria-live="polite"` region.
 * - Error (danger) toasts live in a separate `role="alert"` /
 *   `aria-live="assertive"` region so failures interrupt the user.
 * - Every toast has a manual close button (aria-label "Lukk varsel") and is
 *   keyboard-dismissible; auto-dismiss pauses while focus is inside the stack,
 *   while the pointer rests on a toast, and while a modal is open.
 * - Under a modal the stack is inert, so what arrives meanwhile is announced
 *   by the regions beside it (see `announce`).
 */
export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const stackRef = useRef<HTMLDivElement>(null);
  // Whether focus is inside the stack. State, not a ref: the timers only
  // stop when the rows re-render with it. Kept in a ref, focus changed
  // nothing, and a focused "Angre" was removed at 8.1s regardless (measured,
  // critique run 12).
  const [focusWithin, setFocusWithin] = useState(false);

  // The toasts as they are right now. Updated in the same call as the state,
  // not in an effect after it: the app withdraws undos from its own effects,
  // which run before this provider's, and against a list one render stale an
  // undo just used by Angre would be announced as withdrawn.
  const toastsRef = useRef<ToastItem[]>([]);
  const commit = useCallback((next: ToastItem[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);
  // Where focus came from when it entered the stack: the other place a toast
  // can hand it back to.
  const entryRef = useRef<HTMLElement | null>(null);

  // A toast that holds focus hands it back before it goes, however it goes:
  // closed, used, replaced, or withdrawn by the app. First to where the user
  // was when it appeared, else to where they came from into the toasts, else
  // to the page's focus home (`[data-focus-home]`, the search field). The
  // first alone was often gone: the button that raised a toast is usually
  // the one its action removed ("Lukk veibeskrivelse", "Fjern"), and closing
  // such a toast dropped focus on the page (critique runs 12–14).
  const release = useCallback((id: string) => {
    // Searched for in the page, not in the stack: an undo shown in the place
    // the removed thing had (see UndoNotice) hands focus back the same way.
    const node = document.querySelector(`[data-toast-id="${CSS.escape(id)}"]`);
    if (!node || !node.contains(document.activeElement)) return;
    const candidates = [
      toastsRef.current.find((t) => t.id === id)?.origin,
      entryRef.current,
      document.querySelector<HTMLElement>('[data-focus-home]')
    ];
    const target = candidates.find(
      (el): el is HTMLElement => Boolean(el?.isConnected) && !stackRef.current?.contains(el as Node)
    );
    target?.focus({ preventScroll: true });
  }, []);

  // What the stack cannot say for itself is said by two regions beside it.
  // An undo that goes without the user closing it (replaced by a newer one
  // about the same thing, or withdrawn because what it would restore is gone)
  // says so, or a screen reader only ever hears the undos that arrive. And a
  // toast raised while a modal holds the stack inert is said there: the inert
  // stack is out of the accessibility tree, and it comes back when the dialog
  // closes as regions created with their content, which screen readers do not
  // read. A warning raised under Kartlag was seen, dimmed behind the scrim,
  // but never heard (polish, critique run 14).
  const [spoken, setSpoken] = useState({ polite: '', assertive: '' });
  const announce = useCallback((text: string, assertive = false) => {
    const region = assertive ? 'assertive' : 'polite';
    setSpoken((current) => ({ ...current, [region]: '' }));
    const say = () => setSpoken((current) => ({ ...current, [region]: text }));
    if (typeof requestAnimationFrame === 'undefined') say();
    else requestAnimationFrame(say);
  }, []);
  const announceGone = useCallback(
    (message: string) => announce(`Kan ikke lenger angres: ${message}`),
    [announce]
  );

  const remove = useCallback(
    (id: string, byApp: boolean) => {
      release(id);
      const going = toastsRef.current.find((t) => t.id === id);
      if (!going) return;
      if (byApp && going.action) announceGone(going.message);
      commit(toastsRef.current.filter((t) => t.id !== id));
    },
    [release, announceGone, commit]
  );
  // The app withdrawing a toast, and the user (or its timer) closing it.
  const dismiss = useCallback((id: string) => remove(id, true), [remove]);
  const close = useCallback((id: string) => remove(id, false), [remove]);

  const push = useCallback(
    (message: string, variant: ToastVariant, opts?: ToastOptions): string => {
      const id = opts?.id ?? nextId();
      const timeout =
        opts?.timeout !== undefined ? opts.timeout : opts?.action ? false : DEFAULT_TIMEOUTS[variant];
      const active = typeof document === 'undefined' ? null : document.activeElement;
      const item: ToastItem = {
        id,
        message,
        variant,
        timeout,
        action: opts?.action,
        seq: ++seqCounter,
        subject: opts?.subject,
        inline: opts?.inline,
        origin:
          active instanceof HTMLElement && active !== document.body && !stackRef.current?.contains(active)
            ? active
            : null
      };
      // One waiting undo per subject: a newer undo replaces only one about the
      // same thing. With one for everything, a star click threw away the undo
      // of an area answer that took a minute to compute (critique run 14).
      const subject = opts?.subject ?? id;
      const replaced = opts?.action
        ? toastsRef.current.filter((t) => t.action && t.id !== id && (t.subject ?? t.id) === subject)
        : [];
      replaced.forEach((t) => {
        release(t.id);
        announceGone(t.message);
      });
      const prev = toastsRef.current.filter((t) => !replaced.some((r) => r.id === t.id));
      const existing = prev.findIndex((t) => t.id === id);
      commit(existing !== -1 ? prev.map((t, i) => (i === existing ? item : t)) : [...prev, item]);
      // Under a modal the stack is inert and cannot announce it (see `announce`).
      if (stackRef.current?.hasAttribute('inert')) announce(message, variant === 'danger');
      return id;
    },
    [release, announce, announceGone, commit]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, opts) => push(message, 'success', opts),
      error: (message, opts) => push(message, 'danger', opts),
      info: (message, opts) => push(message, 'info', opts),
      warning: (message, opts) => push(message, 'warning', opts),
      dismiss
    }),
    [push, dismiss]
  );

  // Timers hold while focus is in the stack, and while a modal is open: under
  // the Kartlag dialog a warning raised meanwhile ran out unseen behind the
  // scrim (critique run 14). Under a modal the stack is also inert, so the
  // keyboard and the screen reader stay with the dialog; what arrives
  // meanwhile is announced beside it.
  const modalOpen = useModalOpen();
  const paused = focusWithin || modalOpen;
  useEffect(() => {
    stackRef.current?.toggleAttribute('inert', modalOpen);
  }, [modalOpen]);

  // An undo shown in place is not in the stack: its surface renders it (see
  // UndoNotice). Everything else about it is unchanged, so the rules — one per
  // subject, no timer, withdrawn when stale, announced when it goes without
  // being used — stay in one place.
  const inlineUndos = useMemo(() => toasts.filter((t) => t.inline), [toasts]);
  const noteEntry = useCallback((from: HTMLElement | null) => {
    entryRef.current = from;
  }, []);
  const inline = useMemo(
    () => ({ undos: inlineUndos, close, noteEntry }),
    [inlineUndos, close, noteEntry]
  );
  const stacked = toasts.filter((t) => !t.inline);
  const errorToasts = stacked.filter((t) => t.variant === 'danger');
  const statusToasts = stacked.filter((t) => t.variant !== 'danger');

  // While focus is within the stack, pause timers; once it leaves, the
  // remaining toasts restart their countdown.
  const handleFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const from = e.relatedTarget as HTMLElement | null;
    if (!from || !e.currentTarget.contains(from)) entryRef.current = from;
    setFocusWithin(true);
  }, []);
  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
  }, []);
  // Removing the toast that holds focus sends no blur, so without this the
  // stack stayed "in use" for good and no later toast ever closed on its own
  // (one sat over the Kartlag dialog for minutes; measured, critique run 12).
  useEffect(() => {
    if (focusWithin && !stackRef.current?.contains(document.activeElement)) setFocusWithin(false);
  }, [toasts, focusWithin]);

  const stackStyle: React.CSSProperties = {
    position: 'fixed',
    // Below the top-right cluster (basemap select, Kartlag button and the
    // layer-count chip end at ~94px), so a toast never covers a control.
    // An open top-right panel (Systemhelse) moves the stack below itself
    // through --toast-top, so a toast never covers it either.
    top: 'var(--toast-top, 6rem)',
    right: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    pointerEvents: 'none'
  };

  return (
    <ToastContext.Provider value={api}>
      <InlineUndoContext.Provider value={inline}>{children}</InlineUndoContext.Provider>
      {/* The toast layer steps back from a modal on its own terms, so the
          modal's own "everything outside goes inert" leaves it alone
          (`data-toast-layer`, see useInertOutside): the stack goes inert,
          while the regions that speak for it stay live. */}
      <div data-toast-layer="">
        {/* The toast tier (`z-toast`, above panels and dialogs), except under a
            modal dialog: see `.toast-stack` in app.css. */}
        <div
          ref={stackRef}
          className="toast-stack z-toast"
          data-under-modal={modalOpen || undefined}
          style={stackStyle}
          onFocus={handleFocus}
          onBlur={handleBlur}
        >
          {/* Assertive region for errors — interrupts the screen reader. */}
          <div role="alert" aria-live="assertive" style={{ display: 'contents' }}>
            {errorToasts.map((toast) => (
              <ToastRow key={toast.id} toast={toast} onDismiss={close} paused={paused} />
            ))}
          </div>
          {/* Polite region for success/info/warning. */}
          <div aria-live="polite" style={{ display: 'contents' }}>
            {statusToasts.map((toast) => (
              <ToastRow key={toast.id} toast={toast} onDismiss={close} paused={paused} />
            ))}
          </div>
        </div>
        {/* Always mounted and never inert, so what they say is heard. */}
        <p aria-live="polite" className="sr-only">
          {spoken.polite}
        </p>
        <p aria-live="assertive" className="sr-only">
          {spoken.assertive}
        </p>
      </div>
    </ToastContext.Provider>
  );
};

export default ToastProvider;
