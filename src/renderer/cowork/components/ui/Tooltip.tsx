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

import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';

// Tooltips that hint a frequently-used control should appear fast; the
// Base UI default (600ms) feels sluggish for top-bar icons.
const DEFAULT_DELAY_MS = 250;

// Parses a CSS time ("0", "0ms", "0s", "250ms", "0.8s"). Returns null for
// an empty or unreadable value so the caller falls back to the default.
export function parseTooltipDelay(raw: string): number | null {
  const match = /^(\d*\.?\d+)(ms|s)?$/.exec(raw.trim());
  if (!match) return null;
  return parseFloat(match[1]) * (match[2] === 's' ? 1000 : 1);
}

// The open delay comes from the `--tooltip-delay` token (globals.css), which
// Code Mode sets to 0ms through html[data-workspace]. The value is cached
// per workspace, and a workspace switch re-renders every mounted tooltip, so
// a tooltip never opens with the previous workspace's delay.
function workspaceKey(): string {
  return typeof document === 'undefined' ? '' : document.documentElement.dataset.workspace ?? '';
}

let cached: { key: string; delay: number } | null = null;

function delayFor(key: string): number {
  if (cached?.key === key) return cached.delay;
  const raw = typeof document === 'undefined'
    ? ''
    : getComputedStyle(document.documentElement).getPropertyValue('--tooltip-delay');
  cached = { key, delay: parseTooltipDelay(raw) ?? DEFAULT_DELAY_MS };
  return cached.delay;
}

function subscribeToWorkspace(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(() => {
    cached = null;
    onChange();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-workspace'] });
  return () => observer.disconnect();
}

function useTooltipDelay(): number {
  const key = useSyncExternalStore(subscribeToWorkspace, workspaceKey, () => '');
  return delayFor(key);
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

export function Tooltip({
  content,
  children,
  side = 'bottom',
  sideOffset = 8,
  delay,
  className,
}: TooltipProps) {
  const tokenDelay = useTooltipDelay();
  // No content → render the trigger bare so callers can pass a
  // possibly-empty label without branching.
  if (content == null || content === '') return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={delay ?? tokenDelay} render={children} />
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
