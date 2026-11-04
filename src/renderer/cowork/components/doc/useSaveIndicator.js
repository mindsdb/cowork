// "Saving…" for a doc editor, wherever it is hosted. An edit is
// saving while it waits in an editable (EditableText's debounce, a code block
// until it is left; each reports that through PendingEdits) or in the doc's
// write queue (useDoc's `saving`) — and only then: typing that edits nothing,
// like a request to the agent or a link being pasted, is not saving.
import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from 'react';

/** `(key, pending)`: each editable says when its typed text starts and stops waiting. */
export const PendingEdits = createContext(null);

/**
 * An editable's side of PendingEdits: `dirty` holds whether it has typed text
 * not yet committed, and `setDirty` says so to the save indicator around it.
 */
export function usePendingEdit() {
  const dirty = useRef(false);
  const key = useId();
  const report = useContext(PendingEdits);
  const setDirty = useCallback((next) => {
    if (dirty.current === next) return;
    dirty.current = next;
    report?.(key, next);
  }, [report, key]);
  return { dirty, setDirty };
}

/**
 * Runs the editable's latest `flush` as it goes, so text still waiting (a doc
 * closed from the keyboard, a block re-rendered as another kind, neither with
 * a blur) is committed, not dropped. A layout cleanup, so the element and its
 * text are still there to read.
 */
export function useFlushOnUnmount(flush) {
  const latest = useRef(flush);
  useLayoutEffect(() => { latest.current = flush; });
  useLayoutEffect(() => () => latest.current(), []);
}

/** `{ saving, onPendingChange }`; give `onPendingChange` to a PendingEdits provider around the editor. */
export function useSaveIndicator(writing) {
  const waiting = useRef(new Set());
  const [typing, setTyping] = useState(false);
  const onPendingChange = useCallback((key, pending) => {
    if (pending) waiting.current.add(key);
    else waiting.current.delete(key);
    setTyping(waiting.current.size > 0);
  }, []);
  return { saving: writing || typing, onPendingChange };
}
