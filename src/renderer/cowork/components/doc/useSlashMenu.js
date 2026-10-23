// The "/" menu's state: the block it is under, what has been typed after the
// "/", and the active item. The block keeps the focus and drives it.
import { useCallback, useState } from 'react';
import { slashAfterInput, slashItems } from './canvasOps';

const NONE = [];

/** `onChoose(block, item)` acts on a pick; the menu has closed by then. */
export function useSlashMenu({ canAsk, onChoose }) {
  const [slash, setSlash] = useState(null); // {blockId, query, index, rect, fromButton}
  const items = slash ? slashItems(slash.query, canAsk) : NONE;
  // Stable: the canvas sets its scroll listener up with it.
  const close = useCallback(() => setSlash(null), []);
  const choose = (b, item) => {
    setSlash(null);
    onChoose(b, item);
  };
  return {
    slash,
    items,
    choose,
    close,
    closeFor: (blockId) => setSlash((s) => (s && s.blockId === blockId ? null : s)),
    hover: (index) => setSlash((s) => s && { ...s, index }),
    /** The "+" button's menu, under the block it just added. */
    openUnder: (blockId, el) => setSlash({ blockId, query: '', rect: el.getBoundingClientRect(), index: 0, fromButton: true }),
    /** Arrows, Enter/Tab and Escape in block `b` while its menu is open; true when the menu took the key. */
    onKeyDown(e, b) {
      if (!slash || slash.blockId !== b.id) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setSlash({ ...slash, index: (slash.index + d + items.length) % Math.max(1, items.length) });
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (items[slash.index]) choose(b, items[slash.index]);
        else setSlash(null);
      } else if (e.key === 'Escape') {
        setSlash(null);
      } else {
        return false;
      }
      e.preventDefault();
      return true;
    },
    /** After typing `plain` into block `b` (its editable is `el`). */
    onInput(b, plain, el) {
      const next = slashAfterInput(slash, b.id, plain);
      if (next !== slash) setSlash(next && !next.rect ? { ...next, rect: el.getBoundingClientRect() } : next);
    },
  };
}
