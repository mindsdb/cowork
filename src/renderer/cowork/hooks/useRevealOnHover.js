import { useEffect, useRef, useState } from 'react';

// Menu's dismissal overlay can swallow the row's mouseleave; clear hover when the menu closes.
// revealed includes open; call sites can add any other always-visible conditions.
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
