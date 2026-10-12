// Parts shared by <ItemCard> and <ListItem>: the stretched activation button
// and the action cluster.
//
// Activation is a real <button> around the title whose ::after stretches over
// the whole item, so the item itself can stay a <div>/<article>/<li> and still
// nest its own buttons (HTML forbids buttons inside a role=button). Controls
// that must sit above the stretched area go in <ItemActions> (always z-10).

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

/** An item's controls, always visible. Sits above the stretched activator. */
export function ItemActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-item-actions="" className={cn('relative z-10 flex shrink-0 items-center gap-1', className)}>
      {children}
    </div>
  );
}

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
   *  control here in `<ItemActions>` so it sits above the activator. */
  meta?: ReactNode;
  /** Kebab etc. Always visible, in flow at the item's end. */
  actions?: ReactNode;
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
