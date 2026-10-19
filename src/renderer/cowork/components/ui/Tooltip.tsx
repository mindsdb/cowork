// Tooltip — a hover/focus hint built on Base UI's Tooltip.
//
// Why a primitive: hover hints were previously done with the native
// `title=""` attribute, which can't be styled, has an inconsistent OS
// delay, and never shows on keyboard focus. Base UI gives us delay
// control, focus support, collision-aware positioning, and a portal
// (so it escapes the artifact modal's clipping / stacking context).
// We own only the skin, wired to the same `--ink` / `--surface` tokens
// the rest of the app uses, so it reads as an inverted high-contrast
// pill in both light and dark themes.
//
//   <Tooltip content="Open local folder">
//     <button>{icon}</button>
//   </Tooltip>

import type { CSSProperties, PointerEventHandler, ReactElement, ReactNode, RefObject } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';

// Used only until globals.css has loaded; the token sets the real delay.
const DEFAULT_DELAY_MS = 0;

// Parses a CSS time ("0", "0ms", "0s", "250ms", "0.8s"). Returns null for
// an empty or unreadable value so the caller falls back to the default.
export function parseTooltipDelay(raw: string): number | null {
  const match = /^(\d*\.?\d+)(ms|s)?$/.exec(raw.trim());
  if (!match) return null;
  return parseFloat(match[1]) * (match[2] === 's' ? 1000 : 1);
}

// The open delay comes from the `--tooltip-delay` motion token on :root
// (globals.css). The first readable value is cached for the session; an
// unreadable one (stylesheet not loaded yet) is retried on the next render.
let cachedDelay: number | null = null;

export function tokenDelay(): number {
  if (cachedDelay != null) return cachedDelay;
  if (typeof document === 'undefined') return DEFAULT_DELAY_MS;
  const parsed = parseTooltipDelay(
    getComputedStyle(document.documentElement).getPropertyValue('--tooltip-delay'),
  );
  if (parsed == null) return DEFAULT_DELAY_MS;
  cachedDelay = parsed;
  return parsed;
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  // Overrides the `--tooltip-delay` token for this one tooltip.
  delay?: number;
  className?: string;
}

const POPUP_STYLE: CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--surface)',
  fontFamily: 'var(--font-body)',
  fontSize: 11.5,
  fontWeight: 500,
  lineHeight: 1.3,
  padding: '5px 9px',
  borderRadius: 7,
  /* The light shadow (sh-2, not sh-popup), so a hint bubble sits lower than
     a dropdown or a modal. */
  boxShadow: 'var(--sh-2)',
  maxWidth: 240,
  userSelect: 'none',
};

export interface TooltipBubbleProps {
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  className?: string;
  // The element the bubble points at, when no Trigger of its Root does.
  anchor?: RefObject<Element | null>;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
}

/* The bubble itself: the portal, positioner and popup in this skin. Tooltip
   renders it under its own Root and Trigger. A caller that opens the Root
   itself, with no Trigger, passes `anchor` (FigureMark, which mounts the Root
   only on first hover or focus). */
export function TooltipBubble({
  children,
  side = 'bottom',
  sideOffset = 8,
  className,
  anchor,
  onPointerEnter,
  onPointerLeave,
}: TooltipBubbleProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner anchor={anchor} side={side} sideOffset={sideOffset} style={{ zIndex: 2000 }}>
        <BaseTooltip.Popup
          className={className}
          style={POPUP_STYLE}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  sideOffset = 8,
  delay,
  className,
}: TooltipProps) {
  // No content → render the trigger bare so callers can pass a
  // possibly-empty label without branching.
  if (content == null || content === '') return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={delay ?? tokenDelay()} render={children} />
      <TooltipBubble side={side} sideOffset={sideOffset} className={className}>
        {content}
      </TooltipBubble>
    </BaseTooltip.Root>
  );
}

export default Tooltip;
