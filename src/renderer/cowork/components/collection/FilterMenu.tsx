// One Filter button for a collection page, and the chips that show what it
// has narrowed. Every facet lives in the menu, so a page's toolbar stays
// [search] [Filter] …… [sort] [view] however many facets it has (Linear,
// Notion). A page with no facets renders no Filter at all.
//
//   const filters = [
//     { id: 'status', label: 'Status', value, allValue: 'all', options, onChange },
//     { id: 'archived', label: 'Archived', toggle: true, value: archived, onChange },
//   ];
//   <FilterRow filter={<FilterMenu filters={filters} />} chips={<FilterChips filters={filters} onClear={reset} />} />
//
// A facet is active when its value differs from `allValue`; a toggle is
// active when on. Chips and the button's count read the same list, so they
// never disagree.

import { Check, ListFilter, X } from 'lucide-react';
import { Icon } from '../ui/Icon';
import Menu from '../ui/Menu';
import { cn } from '../../lib/cn';

export interface FilterOption { value: string; label: string; title?: string }

export type Filter =
  | { id: string; label: string; toggle?: false; value: string; allValue: string; options: FilterOption[]; onChange: (value: string) => void }
  | { id: string; label: string; toggle: true; value: boolean; onChange: (value: boolean) => void };

const isActive = (f: Filter) => (f.toggle ? f.value : f.value !== f.allValue);
const valueLabel = (f: Filter) => (f.toggle ? f.label : f.options.find((o) => o.value === f.value)?.label ?? f.value);

const CHECK = <Icon of={Check} size={14} />;
// Unchecked items keep the check's width so labels line up.
const NO_CHECK = <span className="inline-block w-[14px]" aria-hidden="true" />;

export function FilterMenu({ filters }: { filters: Filter[] }) {
  const active = filters.filter(isActive).length;
  const items = filters.map((f) => (f.toggle
    ? {
      id: f.id,
      label: f.label,
      icon: f.value ? CHECK : NO_CHECK,
      keepOpen: true,
      aria: { role: 'menuitemcheckbox', 'aria-checked': f.value },
      onClick: () => f.onChange(!f.value),
    }
    : {
      id: f.id,
      label: f.label,
      // Keeps facet labels in line with a toggle's check column.
      icon: NO_CHECK,
      hint: isActive(f) ? valueLabel(f) : undefined,
      submenu: f.options.map((o) => ({
        id: `${f.id}:${o.value}`,
        label: o.label,
        title: o.title,
        icon: o.value === f.value ? CHECK : NO_CHECK,
        aria: { role: 'menuitemradio', 'aria-checked': o.value === f.value },
        onClick: () => f.onChange(o.value),
      })),
    }));
  return (
    <Menu
      ariaLabel="Filter"
      width={220}
      items={items}
      trigger={(
        <button
          type="button"
          aria-label={active ? `Filter, ${active} active` : 'Filter'}
          className={cn(
            'inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[7px] border-0 px-[11px] font-body text-[12.5px] text-ink-2',
            'bg-surface-2 hover:bg-surface-3 focus-visible:[box-shadow:var(--ring)] focus-visible:outline-none',
          )}
        >
          <Icon of={ListFilter} size={14} className="text-ink-3" />
          Filter
          {active > 0 && (
            <span className="min-w-[17px] rounded-full bg-[var(--accent-bg)] px-[5px] text-center text-[10.5px] font-semibold leading-[17px] text-accent">
              {active}
            </span>
          )}
        </button>
      )}
    />
  );
}

/** Active filters as removable chips, with Clear when more than one is on. */
export function FilterChips({ filters, onClear }: { filters: Filter[]; onClear: () => void }) {
  const active = filters.filter(isActive);
  if (!active.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters" role="group">
      {active.map((f) => (
        <span key={f.id} className="inline-flex h-[26px] max-w-full items-center overflow-hidden rounded-[6px] border border-solid border-line-2 bg-surface font-body text-xs text-ink-2">
          {!f.toggle && <span className="px-2 text-ink-4">{f.label}</span>}
          <span className={cn('min-w-0 truncate px-2', !f.toggle && 'border-y-0 border-r-0 border-l border-solid border-line')}>{valueLabel(f)}</span>
          <button
            type="button"
            aria-label={`Remove ${f.label} filter`}
            onClick={() => (f.toggle ? f.onChange(false) : f.onChange(f.allValue))}
            className="inline-flex h-full cursor-pointer items-center border-y-0 border-r-0 border-l border-solid border-line bg-transparent px-1.5 text-ink-4 hover:bg-surface-2 hover:text-ink focus-visible:[box-shadow:var(--ring)] focus-visible:outline-none"
          >
            <Icon of={X} size={12} />
          </button>
        </span>
      ))}
      {active.length > 1 && (
        <button type="button" onClick={onClear} className="cursor-pointer border-0 bg-transparent px-1 font-body text-xs text-ink-3 hover:text-ink">
          Clear
        </button>
      )}
    </div>
  );
}
