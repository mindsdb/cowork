// `<Combobox>` — searchable, optionally-grouped picker primitive.
//
// Built on Base UI's Combobox in its "input inside popup" shape: the closed
// control is a Select-style trigger; opening it shows a search input pinned
// above a grouped, scrollable list. Base UI owns filtering, keyboard nav
// (arrows/Enter/Esc, typing lands in the search box), focus management, and
// hiding groups whose items all filtered out — we own only the skin, wired
// to the same design tokens as `Select` (whose trigger cva this reuses, so
// the two controls are indistinguishable when closed).
//
// This is a generic primitive: it knows nothing about what it's picking.
// Domain pickers (e.g. `components/ModelSelect`) build the groups, the
// filter, and the trigger adornments, and compose this for the wiring.
//
//   <Combobox
//     value={id}
//     onValueChange={setId}
//     groups={[{ key: 'fruit', name: 'Fruit', items: [{ value: 'a', label: 'Apple' }] }]}
//   />
//
// Group shape:  { key, name, items }  — `name: null` renders unheaded.
// Item shape:   { value, label, disabled?, title?, tag?, ... }  — extra fields
//   pass through untouched, so domain filters/renderers can read them.
//   `tag` renders as a compact right-aligned pill on the row (a model's version
//   state, the "Needs credits" wallet state, or both) without touching the
//   label, so search still matches the bare model name and nothing truncates.
//
// Optional hooks for domain pickers:
//   - `filter(item, query, contains)`: replaces the default match on
//     label + value. `contains` is Base UI's locale-aware substring test.
//   - `renderValue(selected)`: replaces the default trigger content
//     (truncated label, or placeholder styling when nothing is selected).

import { useMemo } from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { ChevronsUpDown, Check, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import Spinner from './Spinner.jsx';
import { triggerVariants } from './Select.jsx';

const CARET_UP_DOWN = <ChevronsUpDown size={11} strokeWidth={1.5} aria-hidden="true" />;

const CHECK = <Check size={12} strokeWidth={1.5} aria-hidden="true" />;

const SEARCH = <Search size={14} strokeWidth={1.5} aria-hidden="true" />;

export function Combobox({
  value,
  onValueChange,
  // Optional controlled open state — omit for the usual uncontrolled
  // popup. Lets a caller force-close the popup itself (e.g. a row's own
  // action navigates elsewhere and the popup underneath would otherwise
  // linger open behind whatever that action opens).
  open,
  // Fires on open and on close, same contract as Select — callers refresh
  // their options on open and the popup reconciles in place.
  onOpenChange,
  groups = [],
  filter,
  renderValue,
  placeholder = 'Select',
  searchPlaceholder = 'Search',
  searchAriaLabel = 'Search',
  emptyText = 'No results',
  variant = 'field',
  size = 'md',
  disabled = false,
  loading = false,
  invalid = false,
  ariaLabel,
  title,
  id,
  width,
  minWidth,
  className,
  style,
  zIndex = 95,
  ...rest
}) {
  const entries = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // The controlled selection as an item object (Combobox deals in items,
  // call sites deal in string ids). A value with no matching option still
  // renders on the trigger via a synthesized entry — resilience for when
  // the saved value vanished from the list.
  const selected = useMemo(() => {
    if (value == null || value === '') return null;
    return entries.find((o) => o.value === value) || { value, label: String(value) };
  }, [entries, value]);

  const { contains } = BaseCombobox.useFilter();

  return (
    <BaseCombobox.Root
      items={groups}
      value={selected}
      onValueChange={(item) => onValueChange?.(item ? item.value : '')}
      open={open}
      onOpenChange={onOpenChange}
      isItemEqualToValue={(a, b) => a?.value === b?.value}
      itemToStringLabel={(item) => item?.label ?? ''}
      // Default: match on the display label OR the raw id, across every
      // group at once. Domain pickers override via `filter`.
      filter={(item, query) => (filter
        ? filter(item, query, contains)
        : contains(item?.label ?? '', query) || contains(item?.value ?? '', query))}
      autoHighlight
      disabled={disabled}
      id={id}
    >
      <BaseCombobox.Trigger
        className={cn(variant === 'unstyled' ? null : triggerVariants({ variant, size }), className)}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-busy={loading || undefined}
        title={title}
        style={{ width, minWidth, ...style }}
        {...rest}
      >
        <span className="flex items-center gap-[8px] min-w-0">
          {renderValue ? renderValue(selected) : (
            <span className={cn('truncate', !selected && 'text-ink-4')}>
              {selected ? selected.label : placeholder}
            </span>
          )}
        </span>
        <span className="inline-flex shrink-0 text-ink-3">
          {loading ? <Spinner style={{ color: 'currentColor' }} /> : CARET_UP_DOWN}
        </span>
      </BaseCombobox.Trigger>
      <BaseCombobox.Portal>
        <BaseCombobox.Backdrop className="fixed inset-0" />
        <BaseCombobox.Positioner
          className="box-border outline-none"
          sideOffset={6}
          align="start"
          style={{ zIndex }}
        >
          <BaseCombobox.Popup
            className={cn(
              // overflow-hidden clips the square-cornered search row to the
              // popup's rounded corners.
              'flex flex-col overflow-hidden w-[max(var(--anchor-width),240px)] max-w-[var(--available-width)]',
              // Same bordered-popup treatment as Select/Menu. `border-solid`
              // is load-bearing: preflight is disabled, so a bare `border`
              // sets width but leaves style at the UA default `none`.
              'bg-surface border border-solid border-line rounded-[10px] shadow-sh-popup outline-none font-body',
              '[transform-origin:var(--transform-origin)]',
              'data-[open]:animate-scale-in data-[closed]:animate-scale-out',
            )}
          >
            {/* Search row — pinned; only the list below scrolls. Border
                widths are set per-side: with preflight disabled,
                `border-solid` alone would resurrect the UA's `medium`
                width on the sides `border-b` doesn't touch, drawing a fat
                box around the whole row. */}
            <div className="flex items-center gap-[8px] px-[12px] py-[9px] border-solid border-line border-b border-t-0 border-x-0 text-ink-4">
              {SEARCH}
              <BaseCombobox.Input
                placeholder={searchPlaceholder}
                aria-label={searchAriaLabel}
                className="flex-1 min-w-0 border-0 bg-transparent p-0 outline-none font-body text-[13px] text-ink placeholder:text-ink-4"
              />
            </div>
            {/* Base UI keeps this root element mounted at all times (needed
                for its live-region announcement), only nulling out the
                children once the list has matches — so with no `empty:`
                guard the padding alone renders as a blank strip above the
                results. `:empty` only matches when there are truly no
                child nodes, which is exactly the has-results case here. */}
            <BaseCombobox.Empty className="empty:p-0 px-[14px] py-[10px] text-[12.5px] text-ink-4">
              {emptyText}
            </BaseCombobox.Empty>
            <BaseCombobox.List className="max-h-[min(320px,calc(var(--available-height,320px)-44px))] overflow-y-auto overscroll-contain py-[4px] outline-none empty:p-0">
              {(group) => (
                <BaseCombobox.Group key={group.key} items={group.items}>
                  {group.name && (
                    <BaseCombobox.GroupLabel className="pt-[8px] px-[14px] pb-[3px] text-[11.5px] text-ink-4 select-none">
                      {group.name}
                    </BaseCombobox.GroupLabel>
                  )}
                  <BaseCombobox.Collection>
                    {(item) => (
                      <BaseCombobox.Item
                        key={item.value}
                        value={item}
                        disabled={item.disabled}
                        title={item.title}
                        className={cn(
                          'grid items-center gap-[6px]',
                          (item.tag || item.action) ? 'grid-cols-[16px_1fr_auto]' : 'grid-cols-[16px_1fr]',
                          'w-[calc(100%-8px)] mx-[4px] px-[10px] py-[7px] rounded-[5px]',
                          'text-[13px] text-ink-2 cursor-pointer select-none outline-none box-border',
                          'data-[highlighted]:bg-surface-2',
                          'data-[disabled]:opacity-55 data-[disabled]:cursor-not-allowed',
                        )}
                      >
                        <span className="inline-flex justify-center text-accent">
                          <BaseCombobox.ItemIndicator>{CHECK}</BaseCombobox.ItemIndicator>
                        </span>
                        <span className="min-w-0 truncate">{item.label}</span>
                        {(item.tag || item.action) && (
                          <span className="shrink-0 flex items-center gap-[6px]">
                            {item.tag && (
                              <span className="rounded-full border border-line px-[7px] py-[1px] text-[10.5px] leading-[15px] text-ink-4 select-none">
                                {item.tag}
                              </span>
                            )}
                            {/* A per-item trailing action (e.g. a settings
                                shortcut) — a plain React node so the caller
                                owns its own onClick (must stopPropagation,
                                or the click also selects this item). */}
                            {item.action}
                          </span>
                        )}
                      </BaseCombobox.Item>
                    )}
                  </BaseCombobox.Collection>
                </BaseCombobox.Group>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}

export default Combobox;
