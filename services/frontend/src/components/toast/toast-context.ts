import React from 'react';

export type ToastVariant = 'success' | 'danger' | 'info' | 'warning';

/** One text action shown in the toast, e.g. "Angre" after a destructive action. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  /** ms until auto-dismiss, or false to keep it until manually dismissed. */
  timeout: number | false;
  action?: ToastAction;
  /** Bumped on every push, so a replaced toast restarts its timer. */
  seq: number;
  /**
   * What had focus when the toast appeared (the star that was pressed, the
   * field the user was in). Closing the toast from inside hands focus back
   * there rather than dropping it on the page.
   */
  origin?: HTMLElement | null;
  /** What an undo is about; a newer undo replaces only one about the same. */
  subject?: string;
  /** Shown where the removed thing was, not in the stack (see UndoNotice). */
  inline?: boolean;
}

/** A waiting undo, as the surface that hosts it needs it. */
export interface InlineUndo {
  id: string;
  message: string;
  action: ToastAction;
  /** Put it away without acting on it (its "×", or Escape inside it). */
  close: () => void;
  /** Report where focus entered it from, so closing hands focus back there. */
  noteEntry: (from: HTMLElement | null) => void;
}

/**
 * The undos waiting in place, for the surfaces that show them. Consumed
 * through `useInlineUndo(subject)`; `null` outside a ToastProvider, where a
 * surface simply shows none.
 */
export const InlineUndoContext = React.createContext(
  null as
    | {
        undos: ToastItem[];
        close: (id: string) => void;
        /** Where focus came into the undo from; it goes back there. */
        noteEntry: (from: HTMLElement | null) => void;
      }
    | null
);

export interface ToastApi {
  /** Show a success toast. Returns the toast id. */
  success: (message: string, opts?: ToastOptions) => string;
  /** Show an error/danger toast (announced assertively). Returns the toast id. */
  error: (message: string, opts?: ToastOptions) => string;
  /** Show an informational toast. Returns the toast id. */
  info: (message: string, opts?: ToastOptions) => string;
  /** Show a warning toast. Returns the toast id. */
  warning: (message: string, opts?: ToastOptions) => string;
  /** Dismiss a toast by id. */
  dismiss: (id: string) => void;
}

export interface ToastOptions {
  /** Override the default auto-dismiss timeout (ms). Pass false to disable. */
  timeout?: number | false;
  /**
   * Reuse/replace an existing toast by id. Give toasts about the same thing
   * (the star, a measurement) one id so quick repeats replace, not stack.
   */
  id?: string;
  /**
   * An undo-style action. A toast with one has no timer: it stays until used,
   * closed, replaced by a newer undo about the same subject, or withdrawn
   * (`dismiss`) when what it would restore is gone.
   */
  action?: ToastAction;
  /**
   * What the undo is about ("saved-place" for every place removed from Mine
   * steder). A newer undo replaces only a waiting one about the same subject;
   * undos about different things wait side by side. Defaults to the id.
   */
  subject?: string;
  /**
   * Show this undo where the removed thing was — the results list's place in
   * the rail, the route panel's, the row it cleared — instead of in the toast
   * stack. The surface renders `<UndoNotice subject="…" />`; everything else
   * about it (one per subject, no timer, withdrawn when stale) is unchanged.
   */
  inline?: boolean;
}

/**
 * Context carrying the imperative toast API. Consumed via the `useToast` hook;
 * `null` until a `ToastProvider` is mounted (the hook throws in that case).
 */
export const ToastContext = React.createContext(null as ToastApi | null);
