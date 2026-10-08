// Card layout of a collection item, and the grid that holds the cards.
//
//   <CardGrid className="px-8 pt-5 pb-14">
//     {items.map((i) => <ItemCard key={i.id} {...slots(i)} />)}
//     <NewTile label="New project" onClick={create} />
//   </CardGrid>
//
// One card language: flat at rest (border only), lift on hover when it opens,
// one title line, a muted description, meta as a quiet footer. Slots are the
// same as <ListItem>'s; see itemParts.tsx.

import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Card } from '../ui/Card';
import { cn } from '../../lib/cn';
import { ITEM_ROOT, ItemActions, ItemTitle } from './itemParts';
import type { ItemElement, ItemSlots } from './itemParts';

export interface CardGridProps {
  children: ReactNode;
  /** Layout only (page padding). */
  className?: string;
}

/** Responsive card grid, the same track and gap as the loading skeleton. */
export function CardGrid({ children, className }: CardGridProps) {
  return <div className={cn('grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[14px]', className)}>{children}</div>;
}

export interface ItemCardProps extends ItemSlots, Omit<HTMLAttributes<HTMLElement>, 'title' | 'children' | 'className'> {
  /** Container tag; activation is always the nested title button. */
  as?: ItemElement;
}

export const ItemCard = forwardRef<HTMLElement, ItemCardProps>(function ItemCard({
  as = 'div', leading, title, badges, description, meta, actions,
  onActivate, activateLabel, selected = false, busy = false, children, className, ...rest
}, ref) {
  return (
    <Card
      ref={ref}
      as={as}
      flat
      interactive={!!onActivate && !busy}
      selected={selected}
      padding="cozy"
      aria-busy={busy || undefined}
      className={cn(ITEM_ROOT, 'flex min-h-[120px] flex-col gap-2', busy && 'opacity-60', className)}
      {...rest}
    >
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        {leading && <span className="inline-flex shrink-0 text-ink-4">{leading}</span>}
        <ItemTitle
          title={title}
          onActivate={onActivate}
          activateLabel={activateLabel}
          busy={busy}
          className="font-body text-base font-medium text-ink has-[input]:flex-1"
        />
        {badges}
        {/* Actions take their own width at the end of the title row, so the
            title truncates beside them instead of under them. */}
        {actions && <ItemActions className="ml-auto">{actions}</ItemActions>}
      </div>
      {description && <div className="line-clamp-2 font-body text-sm leading-normal text-ink-3">{description}</div>}
      {children}
      {meta && <div className="mt-auto flex min-w-0 items-center gap-3 pt-1 font-body text-xs text-ink-4">{meta}</div>}
    </Card>
  );
});
ItemCard.displayName = 'ItemCard';

export default ItemCard;
