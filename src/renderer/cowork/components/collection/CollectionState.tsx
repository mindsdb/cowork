// Body state for a collection page: loading, empty, or no-match. Renders its
// children when none applies, so a page wraps its grid or list once instead of
// chaining its own ternaries.
//
//   <CollectionState
//     loading={loading}
//     total={projects.length}
//     shown={visible.length}
//     query={search}
//     onClear={() => setSearch('')}
//     skeleton={effectiveView === 'grid' ? 'cards' : 'rows'}
//     skeletonClassName="pt-1.5 px-8 mt-[18px]"
//     empty={{ icon, title: 'No projects yet', description, action }}
//   >
//     {grid or list}
//   </CollectionState>
//
// `empty` takes `<EmptyState>` props, so each page keeps its own copy and CTA.
// No-match reads "No results for “query”" with a Clear search action; pages
// whose filters go beyond search pass `noMatchTitle` and `clearLabel`.

import type { ReactNode } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import type { EmptyStateProps } from '../ui/EmptyState';
import { cn } from '../../lib/cn';
import { ListGroup } from './ListGroup';

// One shimmer bar. The `background` stays inline: the shorthand resets
// background-image, which keeps .collection-shimmer's gradient suppressed
// (the look Projects has always had); a bg-* utility would newly reveal it.
function Bar({ className }: { className: string }) {
  return <div style={{ background: 'var(--surface-2)' }} className={cn('rounded collection-shimmer', className)} />;
}

export function SkeletonCard() {
  return (
    <div className="min-h-[120px] rounded-card py-[14px] px-4 border border-solid border-line bg-surface flex flex-col gap-[10px]">
      <Bar className="h-3.5 w-3/5" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Bar className="h-[11px] w-[90%]" />
        <Bar className="h-[11px] w-[70%]" />
      </div>
      <Bar className="h-3 w-1/2" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-2 py-3 border-b border-t-0 border-x-0 border-solid border-line">
      <Bar className="h-3.5 w-1/4" />
      <Bar className="h-[11px] flex-1" />
      <Bar className="h-[11px] w-16" />
    </div>
  );
}

/** A comfortable <ListItem> placeholder: leading icon, title over a
 *  description, and meta at the end. */
export function SkeletonGroupRow() {
  return (
    <div className="flex min-h-[60px] items-center gap-x-3 px-4 py-3">
      <span className="inline-flex w-6 shrink-0 justify-center"><Bar className="size-3.5" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Bar className="h-3.5 w-1/3" />
        <Bar className="h-[11px] w-1/2" />
      </div>
      <Bar className="h-[11px] w-20 shrink-0 max-sm:hidden" />
    </div>
  );
}

export interface CollectionStateProps {
  /** Items are still loading; shows skeletons. */
  loading?: boolean;
  /** Item count before filtering. Zero shows the empty state. */
  total: number;
  /** Item count after filtering. Zero (with `total` > 0) shows no-match. */
  shown: number;
  query?: string;
  onClear?: () => void;
  noMatchTitle?: ReactNode;
  clearLabel?: string;
  /** `cards` for a card grid, `rows` for a hairline list, `group` for rows
   *  in a <ListGroup>. */
  skeleton?: 'cards' | 'rows' | 'group';
  skeletonCount?: number;
  /** Layout (padding/margin) of the skeleton wrapper, matching the page body. */
  skeletonClassName?: string;
  /** Grid for card skeletons. Pass the page's own grid class so the skeleton
   *  has the same columns as the loaded cards. */
  skeletonGridClassName?: string;
  empty: EmptyStateProps;
  children?: ReactNode;
}

export function CollectionState({
  loading = false,
  total,
  shown,
  query = '',
  onClear,
  noMatchTitle,
  clearLabel = 'Clear search',
  skeleton = 'cards',
  skeletonCount = 6,
  skeletonClassName,
  skeletonGridClassName = 'grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[14px]',
  empty,
  children,
}: CollectionStateProps) {
  if (loading) {
    const items = Array.from({ length: skeletonCount });
    if (skeleton === 'group') {
      return (
        <ListGroup aria-busy="true" aria-label="Loading" className={skeletonClassName}>
          {items.map((_, i) => <SkeletonGroupRow key={i} />)}
        </ListGroup>
      );
    }
    return (
      <div
        aria-busy="true"
        aria-label="Loading"
        className={cn(skeleton === 'cards' && skeletonGridClassName, skeletonClassName)}
      >
        {items.map((_, i) => (skeleton === 'cards' ? <SkeletonCard key={i} /> : <SkeletonRow key={i} />))}
      </div>
    );
  }
  if (total === 0) return <EmptyState {...empty} />;
  if (shown === 0) {
    const q = query.trim();
    return (
      <EmptyState
        icon={<span className="inline-flex text-ink-4">{Ico.search(20)}</span>}
        title={noMatchTitle ?? (q ? `No results for “${q}”` : 'No results')}
        action={onClear && <Button variant="subtle" onClick={onClear}>{clearLabel}</Button>}
        style={{ minHeight: 240 }}
      />
    );
  }
  return <>{children}</>;
}

export default CollectionState;
