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
import { cn } from '../../lib/cn';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  // Tooltips that hint a frequently-used control should appear fast;
  // the Base UI default (600ms) feels sluggish for top-bar icons.
  delay?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  sideOffset = 8,
  delay = 250,
  className,
}: TooltipProps) {
  // No content → render the trigger bare so callers can pass a
  // possibly-empty label without branching.
  if (content == null || content === '') return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={delay} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset} style={{ zIndex: 2000 }}>
          <BaseTooltip.Popup
            // A small hint bubble carries less visual weight than a
            // dropdown/modal (ENG-790) — sh-2, not sh-popup.
            className={cn(
              'bg-ink text-surface font-[family-name:var(--font-body)] text-[11.5px] font-medium leading-[1.3]',
              'py-[5px] px-[9px] rounded-[7px] shadow-sh-2 max-w-[240px] select-none',
              className,
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export default Tooltip;
