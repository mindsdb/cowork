import { useEffect, useRef, useState } from 'react';

// Reveal-on-hover state for a control that also stays visible while its
// menu is open — the kebab pattern used by task rows, project cards,
// artifact cards, the chat header, etc.
//
// It exists to absorb one shared gotcha: the Base UI <Menu> dismiss
// overlay (ui/Menu.jsx, anchored mode) covers the row while the menu is
// open, so the row never receives `mouseleave`. A plain hover boolean
// would therefore stay stuck `true` after the menu closes, leaving the
// kebab visible when the pointer is elsewhere. We clear hover whenever
// `open` flips back to false, so every call site gets the fix for free
// instead of re-implementing it in its own `onClose`.
//
// Usage:
//   const { revealed, hoverProps } = useRevealOnHover(menuOpen);
//   <div {...hoverProps}>
//     <Kebab style={{ opacity: revealed ? 1 : 0 }} />
//   </div>
//
// `revealed` already folds in `open`, so it equals the old
// `hover || menuOpen`. Compose any extra always-on conditions at the
// call site, e.g. `revealed || isReserved`.
export function useRevealOnHover(open = false) {
  const [hovered, setHovered] = useState(false);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (wasOpen.current && !open) setHovered(false);
    wasOpen.current = open;
  }, [open]);

  return {
    // Raw hover, for surfaces that should react to hover alone (e.g. a
    // row background). Still benefits from the close-reset above.
    hovered,
    // Hover OR open — for the control that should also stay visible
    // while its menu is open (the kebab).
    revealed: hovered || open,
    hoverProps: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
  };
}

export default useRevealOnHover;
