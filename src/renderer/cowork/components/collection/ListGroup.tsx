// Row layout of a collection: one rounded container whose rows are split by
// hairlines (t3code `ui/discovery-list.tsx`, ChatGPT Apps rows with a ••• menu).
//
//   <ListGroup title={<h2>GitHub</h2>} actions={<Button>Connect</Button>}>
//     {accounts.map((a) => <ListItem key={a.id} {...slots(a)} />)}
//     <ListNotice>Waiting for GitHub…</ListNotice>
//   </ListGroup>
//
// One rhythm everywhere: no minimum height, so a row's height follows its
// content and a one-line row stays compact.
// Slots are the same as <ItemCard>'s; see itemParts.tsx.

import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import Ico from '../Icons';
import { cn } from '../../lib/cn';
import { ACTIONS_IN_FLOW_ON_TOUCH, HoverActions, ITEM_ROOT, ItemTitle } from './itemParts';
import type { ItemElement, ItemSlots } from './itemParts';

// Padding shared by rows, the new row, and notices.
const ROW_PAD = 'px-4 py-2.5';

export interface ListGroupProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** Optional group header: a heading element, e.g. `<h2>`. */
  title?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  /** Header actions (a Connect button per provider). */
  actions?: ReactNode;
}

export function ListGroup({
  title, description, meta, actions, children, className, ...rest
}: ListGroupProps) {
  const hasHeader = title || description || meta || actions;
  // min-w-0 and minmax(0,1fr) stop a long unwrapped description from
  // widening the group past its parent, so rows truncate instead.
  return (
    <section className={cn('grid min-w-0 grid-cols-1 gap-2', className)} {...rest}>
      {hasHeader && (
        <header className="flex min-h-8 items-center gap-3 px-1">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {/* The kit sets the title's size and weight; a caller's heading
                element keeps its semantics and inherits the look. */}
            <span className="min-w-0 truncate font-body text-base font-semibold text-ink [&>*]:m-0 [&>*]:text-[length:inherit] [&>*]:font-[inherit]">{title}</span>
            {description && <span className="truncate text-sm text-ink-4">{description}</span>}
          </div>
          {meta && <span className="shrink-0 text-sm text-ink-4">{meta}</span>}
          {actions}
        </header>
      )}
      {/* Preflight is off, so each hairline sets its own style and zeroes
          the other sides; end rows take the container's radius. */}
      <div
        className={cn(
          'rounded-card border border-solid border-line bg-surface',
          '[&>*+*]:border-x-0 [&>*+*]:border-b-0 [&>*+*]:border-t [&>*+*]:border-solid [&>*+*]:border-line',
          '[&>*:first-child]:rounded-t-card [&>*:last-child]:rounded-b-card',
        )}
      >
        {children}
      </div>
    </section>
  );
}

const listItem = cva(
  [ITEM_ROOT, 'flex flex-wrap items-center gap-x-3 gap-y-1.5 transition-colors'],
  {
    variants: {
      activatable: { true: 'hover:bg-surface-2', false: '' },
      selected: { true: 'bg-surface-3 hover:bg-surface-3', false: '' },
    },
    defaultVariants: { activatable: false, selected: false },
  },
);

export interface ListItemProps extends ItemSlots, Omit<HTMLAttributes<HTMLElement>, 'title' | 'children' | 'className'> {
  /** Container tag; activation is always the nested title button. */
  as?: ItemElement;
}

export const ListItem = forwardRef<HTMLElement, ListItemProps>(function ListItem({
  as: As = 'div', leading, title, badges, description, meta, actions, revealActions,
  onActivate, activateLabel, selected = false, busy = false, children, className, ...rest
}, ref) {
  // Polymorphic tag; `any` sidesteps ref typing across tags (as in ui/Card).
  const Comp: any = As;
  return (
    <Comp
      ref={ref}
      aria-busy={busy || undefined}
      className={cn(
        listItem({ activatable: !!onActivate && !busy, selected }),
        ROW_PAD,
        busy && 'opacity-60',
        className,
      )}
      {...rest}
    >
      {leading && <span className="inline-flex w-6 shrink-0 justify-center text-ink-4">{leading}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <ItemTitle
            title={title}
            onActivate={onActivate}
            activateLabel={activateLabel}
            busy={busy}
            className="font-body text-base font-medium text-ink has-[input]:flex-1"
          />
          {badges}
        </div>
        {description && <div className="truncate font-body text-sm text-ink-3">{description}</div>}
        {children}
      </div>
      {/* Phone width: meta drops under the title instead of squeezing it, and
          wraps rather than widening the page; it may shrink so a long unbroken
          name stays in the row. It goes after the actions, so actions in flow
          stay beside the title. Desktop never wraps (shrink-0). */}
      {meta && (
        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 font-body text-sm text-ink-4',
            'max-sm:order-last max-sm:min-w-0 max-sm:basis-full max-sm:[overflow-wrap:anywhere]',
            leading && 'max-sm:pl-9',
          )}
        >
          {meta}
        </div>
      )}
      {/* Hover-only actions overlay the meta's end (over the row's hover fill)
          so the meta keeps the right edge at rest; the overlay's end matches
          the row padding. Actions shown at rest (revealActions) sit in flow.
          Hover-only ones flow in place on touch, and from sm up whenever the
          row shows a control at rest, which they would cover. Below sm the
          meta has its own line, so flowing there would add a blank line. */}
      {actions && (
        <HoverActions
          reveal={revealActions}
          className={cn(
            !revealActions && [
              'absolute inset-y-0 right-0 rounded-[inherit] bg-[linear-gradient(to_left,var(--surface-2)_75%,transparent)] pl-8 pr-4',
              ACTIONS_IN_FLOW_ON_TOUCH,
              'sm:group-has-[[data-revealed]]/item:static sm:group-has-[[data-revealed]]/item:bg-none sm:group-has-[[data-revealed]]/item:p-0',
            ],
          )}
        >
          {actions}
        </HoverActions>
      )}
    </Comp>
  );
});
ListItem.displayName = 'ListItem';

export interface NewRowProps {
  label: ReactNode;
  onClick: () => void;
  className?: string;
}

/** Trailing "+ New …" row: the list layout's <NewTile>. */
export const NewRow = forwardRef<HTMLButtonElement, NewRowProps>(function NewRow({ label, onClick, className }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        'm-0 flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent text-left font-body text-sm text-ink-3 transition-colors',
        'hover:bg-surface-2 hover:text-ink focus-visible:[box-shadow:var(--ring)] focus-visible:outline-none',
        ROW_PAD,
        className,
      )}
    >
      <span className="inline-flex w-6 shrink-0 justify-center">{Ico.plus(14)}</span>
      {label}
    </button>
  );
});
NewRow.displayName = 'NewRow';

/** A full-width line inside a ListGroup (OAuth waiting, an inline error). */
export function ListNotice({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(ROW_PAD, className)}>{children}</div>;
}
