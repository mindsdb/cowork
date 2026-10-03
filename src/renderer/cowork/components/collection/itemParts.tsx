// Parts shared by <ItemCard> and <ListItem>: the stretched activation button,
// the hover-revealed action cluster, and the menu-trigger classes.
//
// Activation is a real <button> around the title whose ::after stretches over
// the whole item, so the item itself can stay a <div>/<article>/<li> and still
// nest its own buttons (HTML forbids buttons inside a role=button). Controls
// that must sit above the stretched area go in <HoverActions> (always z-10).

import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Root classes for an item that hosts an <ItemActivator>: positioning
 *  context, the reveal group, and the focus ring drawn on the whole item. */
export const ITEM_ROOT = 'group/item relative has-[[data-item-activator]:focus-visible]:[box-shadow:var(--ring)]';

export interface ItemActivatorProps {
  onActivate: () => void;
  /** Accessible name when the visible title is not enough (e.g. "Manage Gmail: work"). */
  label?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export const ItemActivator = forwardRef<HTMLButtonElement, ItemActivatorProps>(function ItemActivator(
  { onActivate, label, disabled, className, children },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-item-activator=""
      aria-label={label}
      disabled={disabled}
      onClick={() => onActivate()}
      className={cn(
        'm-0 min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left',
        'focus-visible:outline-none disabled:cursor-wait',
        "after:absolute after:inset-0 after:content-['']",
        className,
      )}
    >
      {children}
    </button>
  );
});

// Hidden actions also drop pointer events, so an invisible control never
// swallows a click meant for the item. They stay in the tab order: focusing
// one (or the item's activator) reveals the cluster via focus-within.
export const REVEAL_ON_HOVER = [
  'pointer-events-none opacity-0',
  'group-hover/item:pointer-events-auto group-hover/item:opacity-100',
  'group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100',
  // An open menu keeps its trigger visible after the pointer leaves.
  'has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100',
  'has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100',
  // No hover on touch: always visible, or it would be unreachable. A touch
  // laptop reports hover but a coarse pointer, so it counts as touch too.
  '[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
  '[@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100',
].join(' ');

/** Layout classes that drop an overlaid cluster back into flow on touch,
 *  where it is always visible and must not cover the item. */
export const ACTIONS_IN_FLOW_ON_TOUCH = [
  '[@media(hover:none)]:static [@media(hover:none)]:bg-none [@media(hover:none)]:p-0',
  '[@media(pointer:coarse)]:static [@media(pointer:coarse)]:bg-none [@media(pointer:coarse)]:p-0',
].join(' ');

export interface HoverActionsProps {
  children: ReactNode;
  /** Always visible (e.g. a labelled Disconnect, or a caller-owned menu is open). */
  reveal?: boolean;
  /** Layout only (position, padding, background behind an overlay). */
  className?: string;
}

/** The control cluster on an item. Sits above the stretched activator. */
export function HoverActions({ children, reveal = false, className }: HoverActionsProps) {
  return (
    <div data-item-actions="" className={cn('relative z-10 flex shrink-0 items-center gap-1', !reveal && REVEAL_ON_HOVER, className)}>
      {children}
    </div>
  );
}

/** Ghost icon-button classes for an `<OverflowMenu triggerClassName>` inside an item. */
export const ITEM_MENU_TRIGGER = 'h-7 w-7 justify-center rounded-md text-ink-4 hover:bg-surface-2 hover:text-ink';

/** Slots both item layouts share, so a page builds an item once and renders it
 *  as a card or a row. */
export interface ItemSlots {
  /** Icon or logo before the title. */
  leading?: ReactNode;
  /** The one strong line. Wrapped in the activator when `onActivate` is set. */
  title: ReactNode;
  /** Small inline tags after the title (Built-in, Disabled). */
  badges?: ReactNode;
  /** One muted line (row) or up to two (card). */
  description?: ReactNode;
  /** Status and timestamps: right side of a row, footer of a card. Wrap any
   *  control here in `<HoverActions reveal>` so it sits above the activator. */
  meta?: ReactNode;
  /** Kebab etc., revealed on hover / focus-within / open menu / touch. */
  actions?: ReactNode;
  /** Keep `actions` visible at rest. Visible actions sit in flow, so they
   *  never cover the title or meta. */
  revealActions?: boolean;
  /** Opens the item. Omit while the title holds an input (inline rename). */
  onActivate?: () => void;
  /** Accessible name for the activator; defaults to the title text. */
  activateLabel?: string;
  selected?: boolean;
  /** Dims the item, marks it aria-busy, and disables activation. */
  busy?: boolean;
  /** Extra body content (an Alert, a progress line …). */
  children?: ReactNode;
  className?: string;
}

/** Non-interactive container tags an item may render as. */
export type ItemElement = 'div' | 'article' | 'li';

/** The title: the activator when the item opens, plain text otherwise. */
export function ItemTitle({ title, onActivate, activateLabel, busy, className }:
  Pick<ItemSlots, 'title' | 'onActivate' | 'activateLabel' | 'busy'> & { className: string }) {
  return onActivate
    ? <ItemActivator onActivate={onActivate} label={activateLabel} disabled={busy} className={className}>{title}</ItemActivator>
    : <span className={cn('min-w-0 truncate', className)}>{title}</span>;
}
