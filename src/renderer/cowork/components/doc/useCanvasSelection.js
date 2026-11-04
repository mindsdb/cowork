// The person's selection inside the page, for the formatting bar and for the
// chat's doc context: the blocks it spans, its words, and the editable it sits
// in when it sits in one (formatting needs exactly one).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const editableOf = (node) => (node && (node.nodeType === 1 ? node : node.parentElement))?.closest('.doc-editable') || null;

/** `[toolbar, setToolbar]`; `onSelectionChange` hears `{ blockIds, quote }`, or null when it collapses in the page. */
export function useCanvasSelection(rootRef, onSelectionChange) {
  const [toolbar, setToolbar] = useState(null);
  // Read through a ref: the pane's callback changes with every write, and the
  // listener should not be torn down and added again each time.
  const report = useRef(onSelectionChange);
  useLayoutEffect(() => { report.current = onSelectionChange; }, [onSelectionChange]);

  useEffect(() => {
    let frame = 0;
    const onSel = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !root) {
          // The link box takes the focus from the words; its bar stays.
          setToolbar((t) => (t && t.mode === 'link' ? t : null));
          // Only a caret in the page clears what was picked. A selection that
          // left the page keeps it: the focus moving to the chat's composer,
          // to ask about the passage, is what the pick is for.
          if (root && sel?.rangeCount && root.contains(sel.anchorNode)) report.current?.(null);
          return;
        }
        const range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;
        const blockIds = [...root.querySelectorAll('[data-block-id]')]
          .filter((el) => range.intersectsNode(el))
          .map((el) => el.dataset.blockId);
        if (!blockIds.length) return;
        const anchor = editableOf(sel.anchorNode);
        const quote = sel.toString().replace(/\s+\n/g, '\n').slice(0, 2000);
        setToolbar({
          rect: range.getBoundingClientRect(),
          blockIds,
          quote,
          editable: anchor && anchor === editableOf(sel.focusNode) ? anchor : null,
          mode: 'format',
          range: range.cloneRange(),
        });
        report.current?.({ blockIds, quote });
      });
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      cancelAnimationFrame(frame);
    };
  }, [rootRef]);

  return [toolbar, setToolbar];
}
