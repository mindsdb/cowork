// Sort header of a long list (ENG-4455): the first row of a ListGroup, its
// labels sorting the list as the page's SortPill does, and kept in step with
// it. Name sits over the titles; the other columns at the right, ending where
// the rows' menus begin, over the project and the date. It stays at the top
// of the page's scroll while the list passes under it.
//
//   <ListGroup>
//     {rows.length > LIST_SORT_HEADER_MIN && (
//       <ListSortHeader
//         columns={[
//           { id: 'name', label: 'Name', sorts: ['name'] },
//           { id: 'updated', label: 'Updated', sorts: ['recent', 'oldest'] },
//         ]}
//         value={sort}
//         onChange={setSort}
//       />
//     )}
//     {rows.map(...)}
//   </ListGroup>
//
// A column's `sorts` are the page's own sort ids: one, or two that a second
// click switches between (the first is the column's default, its arrow
// pointing down).

import { useCallback } from 'react';
import { cn } from '../../lib/cn';
import { useTranslation } from '../../../lib/i18n';
import Ico from '../Icons';

/** Lists longer than this get the header. */
export const LIST_SORT_HEADER_MIN = 15;

export interface ListSortColumn {
  id: string;
  label: string;
  /** The page's sort ids for this column: [default] or [default, reversed]. */
  sorts: [string] | [string, string];
}

export interface ListSortHeaderProps {
  /** The first is the Name column, over the titles; the rest sit at the right. */
  columns: ListSortColumn[];
  value: string;
  onChange: (sort: string) => void;
  className?: string;
}

type DocumentWithTransitions = Document & { startViewTransition?: (update: () => void) => unknown };

/** A sort change, cross-faded into place where the browser can and motion is welcome. */
function withTransition(update: () => void) {
  const doc = typeof document !== 'undefined' ? (document as DocumentWithTransitions) : null;
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (doc?.startViewTransition && !still) {
    doc.startViewTransition(update);
    return;
  }
  update();
}

function SortButton({ column, value, onChange, align }: {
  column: ListSortColumn; value: string; onChange: (sort: string) => void; align: 'start' | 'end';
}) {
  const { t } = useTranslation('shell');
  const at = column.sorts.indexOf(value);
  const active = at >= 0;
  const reversed = at === 1;
  const next = active ? column.sorts[(at + 1) % column.sorts.length] : column.sorts[0];
  const choose = useCallback(() => {
    if (next !== value) withTransition(() => onChange(next));
  }, [next, onChange, value]);
  return (
    <button
      type="button"
      onClick={choose}
      aria-pressed={active}
      aria-label={t('ui.sortHeader.sortBy', { column: column.label })}
      className={cn(
        'group/sort inline-flex h-6 items-center gap-1 rounded-[6px] border-0 bg-transparent px-1.5 font-body text-xs font-medium',
        'cursor-pointer whitespace-nowrap outline-none transition-colors duration-hover',
        'focus-visible:shadow-[var(--ring)]',
        active ? 'text-ink' : 'text-ink-4 hover:text-ink-2',
        align === 'start' ? '-ml-1.5' : '',
      )}
    >
      {column.label}
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex transition-[transform,opacity] duration-hover ease-out',
          active ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60',
          reversed ? 'rotate-180' : '',
        )}
      >
        {Ico.chevDown(12)}
      </span>
    </button>
  );
}

export function ListSortHeader({ columns, value, onChange, className }: ListSortHeaderProps) {
  const { t } = useTranslation('shell');
  const [name, ...rest] = columns;
  if (!name) return null;
  return (
    <div
      role="toolbar"
      aria-label={t('ui.sortHeader.label')}
      className={cn(
        // Above the rows as the list scrolls under it, in the group's own tones.
        'sticky top-0 z-20 flex items-center gap-x-3 px-4 py-1.5',
        'bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur-[6px]',
        className,
      )}
    >
      {/* The rows' leading icon column. */}
      <span className="w-6 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 items-center">
        <SortButton column={name} value={value} onChange={onChange} align="start" />
      </div>
      {rest.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {rest.map((column) => (
            <SortButton key={column.id} column={column} value={value} onChange={onChange} align="end" />
          ))}
        </div>
      )}
      {/* Over the rows' menus, which stay unlabeled. */}
      <span className="w-6 shrink-0" aria-hidden="true" />
    </div>
  );
}

export default ListSortHeader;
