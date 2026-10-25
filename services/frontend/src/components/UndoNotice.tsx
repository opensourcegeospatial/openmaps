import React, { useRef } from 'react';
import { useInlineUndo } from './toast/useInlineUndo';
import { useIsClamped } from '../hooks/useIsClamped';

interface UndoNoticeProps {
  /** Which undo this surface hosts ("area-results", "route-closed", …). */
  subject: string;
  /**
   * Where it sits: `card` for the rail, where it stands over the map on its
   * own; `inline` inside a panel that already has a surface of its own.
   */
  surface?: 'card' | 'inline';
  className?: string;
}

/**
 * A waiting undo, in the place the removed thing had: the results list's slot
 * in the rail, the route panel's, the row inside a panel that was cleared.
 *
 * Undos used to be toasts, which put them in the top-right corner whatever
 * they were about: four could wait at once over 15% of the map, swallowing
 * clicks there, 23 Tab presses from the action they undid, and looking exactly
 * like a notification that lapses in four seconds (critique run 15). The
 * Kartlag dialog already confirmed a removal in the removed row's place; this
 * is that pattern, for the rest of the app.
 *
 * The wrapper stays mounted and empty, so the notice arriving inside it is a
 * change in a live region a screen reader is already watching — a region that
 * appears with its content is not read (see ToastProvider).
 */
const UndoNotice: React.FC<UndoNoticeProps> = ({ subject, surface = 'inline', className = '' }) => {
  const undo = useInlineUndo(subject);
  const messageId = React.useId();
  // What was removed names itself, and a name has no length limit: a place
  // called "Vitusapotek Jernbanetorget – Oslo City kjøpesenter, 2. etasje ved
  // hovedinngangen" took three lines of the rail and pushed the card and the
  // list down (polish, critique run 15). Two lines, with the rest in a
  // tooltip only when the clamp actually hid something; the message itself
  // stays whole for the screen reader, which reads the element, not the clip.
  const messageRef = useRef<HTMLSpanElement>(null);
  const clamped = useIsClamped(messageRef, 2, undo?.message);
  // In the rail it stands on the map on its own, with the room a card has.
  // Inside a panel it takes that panel's own idiom for a row with an action —
  // the line it replaces ("1 område unngås · Fjern") is exactly that — so it
  // costs the panel as little height as the line did.
  const card = surface === 'card';
  const rowClass = card ? 'gap-3 px-4 py-3 text-sm bg-surface-default shadow-lg' : 'gap-2 px-3 py-2 text-sm';
  const actionClass = card
    ? 'rounded-md border border-border-default px-3 py-1 font-medium text-text-default transition hover:bg-surface-hover focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default'
    : 'rounded text-xs font-medium text-text-default underline transition hover:no-underline';

  return (
    // The wrapper is a marker, not a box: `display: contents` keeps an empty
    // one out of its container's gap rhythm while the live region it carries
    // stays mounted.
    <div role="status" style={{ display: 'contents' }}>
      {undo && (
        <div
          data-toast-id={undo.id}
          data-undo-notice={subject}
          // Where the user came in from: closing the undo hands focus back
          // there when what raised it is gone (see ToastProvider's `release`).
          onFocus={(event: React.FocusEvent<HTMLDivElement>) => {
            const from = event.relatedTarget as HTMLElement | null;
            if (!from || !event.currentTarget.contains(from)) undo.noteEntry(from);
          }}
          // Escape puts it away, as it did while this was a toast; the panel
          // behind never sees that Escape.
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            undo.close();
          }}
          className={`flex items-center rounded-lg border border-border-default text-text-default ${rowClass} ${className}`}
        >
          <span
            id={messageId}
            ref={messageRef}
            title={clamped ? undo.message : undefined}
            className="line-clamp-2 min-w-0 flex-1 break-words"
          >
            {undo.message}
          </span>
          <button
            type="button"
            onClick={() => {
              undo.action.onClick();
              undo.close();
            }}
            aria-describedby={messageId}
            className={`shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default ${actionClass}`}
          >
            {undo.action.label}
          </button>
          <button
            type="button"
            onClick={undo.close}
            aria-label="Lukk meldingen"
            aria-describedby={messageId}
            className="shrink-0 rounded-full p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default UndoNotice;
