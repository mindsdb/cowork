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

import type { ReactElement, ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';

const FALLBACK_DELAY_MS = 200;
let cachedDelay: number | undefined;

// The open delay lives in the `--tooltip-delay` motion token (globals.css),
// so a stylesheet overriding the motion tokens retimes tooltips too. Read
// once, on the first tooltip render.
function tooltipDelay(): number {
  if (cachedDelay !== undefined) return cachedDelay;
  const raw = typeof document === 'undefined' ? ''
    : getComputedStyle(document.documentElement).getPropertyValue('--tooltip-delay').trim();
  const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN;
  cachedDelay = Number.isFinite(ms) ? ms : FALLBACK_DELAY_MS;
  return cachedDelay;
}

// Mount once near the root: after the first tooltip shows, the next one
// opens instantly while the group is warm.
export const TooltipProvider = BaseTooltip.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  // Overrides `--tooltip-delay` for this one tooltip.
  delay?: number;
  className?: string;
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
      <BaseTooltip.Trigger delay={delay ?? tooltipDelay()} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset} style={{ zIndex: 2000 }}>
          <BaseTooltip.Popup
            className={className}
            style={{
              background: 'var(--ink)',
              color: 'var(--surface)',
              fontFamily: 'var(--font-body)',
              fontSize: 11.5,
              fontWeight: 500,
              lineHeight: 1.3,
              padding: '5px 9px',
              borderRadius: 7,
              // A small hint bubble carries less visual weight than a
              // dropdown/modal (ENG-790) — sh-2, not sh-popup.
              boxShadow: 'var(--sh-2)',
              maxWidth: 240,
              userSelect: 'none',
            }}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export default Tooltip;
