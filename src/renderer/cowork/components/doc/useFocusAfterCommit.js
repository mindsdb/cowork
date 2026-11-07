// Put the caret in a block once the render that creates or changes it has
// committed: a split, merge or conversion asks for the caret before the block
// it names exists in the DOM.
import { useCallback, useLayoutEffect, useRef } from 'react';

/** `focusBlock(id, where, after?)`; `after(handle)` runs once the caret is in. */
export function useFocusAfterCommit(handles) {
  const pending = useRef(null);
  useLayoutEffect(() => {
    const want = pending.current;
    const h = want && handles.current.get(want.id);
    if (!h) return; // not rendered yet: the next commit tries again
    pending.current = null;
    h.focus(want.where);
    want.after?.(h);
  });
  return useCallback((id, where = 'end', after = null) => {
    pending.current = { id, where, after };
  }, []);
}
