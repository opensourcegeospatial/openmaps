import { useContext } from 'react';
import { InlineUndoContext, type InlineUndo } from './toast-context';

/**
 * The undo waiting for this subject, for the surface that shows it in the
 * place the removed thing had. Null when nothing is waiting.
 *
 * Every rule about the undo itself lives in the ToastProvider: one per
 * subject, no timer, withdrawn when what it would restore is gone, announced
 * when it goes without being used. This hook only says where it is shown.
 */
export function useInlineUndo(subject: string): InlineUndo | null {
  const context = useContext(InlineUndoContext);
  if (!context) return null;
  const item = context.undos.find((undo) => (undo.subject ?? undo.id) === subject);
  if (!item?.action) return null;
  return {
    id: item.id,
    message: item.message,
    action: item.action,
    close: () => context.close(item.id),
    noteEntry: context.noteEntry
  };
}
