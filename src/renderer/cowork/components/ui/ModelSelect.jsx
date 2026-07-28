// `<ModelSelect>` — searchable, provider-grouped model picker (ENG-1096).
//
// Built on Base UI's Combobox in its "input inside popup" shape: the closed
// control is a Select-style trigger (provider mark + model name + caret);
// opening it shows a search input pinned above a grouped, scrollable list.
// Base UI owns filtering, keyboard nav (arrows/Enter/Esc, typing lands in
// the search box), focus management, and hiding groups whose items all
// filtered out — we own only the skin, wired to the same design tokens as
// `Select` (whose trigger cva this reuses, so the two controls are
// indistinguishable when closed).
//
// Grouping comes from `lib/modelCatalog` (maker inferred from alias+label
// until the backend ships an explicit field — ENG-1111). Provider marks
// come from `ProviderIcon`, with a neutral placeholder for makers we have
// no svg for yet (ENG-1112).
//
// API mirrors `Select` where the two overlap, so call sites swap 1:1:
//
//   <ModelSelect
//     value={modelId}
//     onValueChange={setModelId}
//     options={[
//       { value: 'sonnet', label: 'Claude Sonnet 5' },
//       { value: 'opus', label: 'Claude Opus 5', disabled: true },
//       { value: '__custom__', label: 'Other…', pin: 'bottom' },
//     ]}
//   />
//
// Option shape: { value, label, disabled?, title?, maker?, pin? }.
//   - `maker`: explicit maker key (trusted over inference when present).
//   - `pin: 'top' | 'bottom'`: render outside the maker groups, unheaded,
//     at the top/bottom of the list (stale-pin and "Other…" entries).

import { useMemo } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { cn } from '../../lib/cn';
import { groupModelOptions, modelMaker } from '../../lib/modelCatalog';
import Spinner from './Spinner.jsx';
import ProviderIcon from './ProviderIcon.jsx';
import { triggerVariants } from './Select.jsx';

const CARET_UP_DOWN = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7 9.5 12 4.5l5 5M7 14.5l5 5 5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CHECK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SEARCH = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);

// Pseudo-group keys for pinned (unheaded) entries. Underscored so they can
// never collide with a real maker key from modelCatalog.
const PIN_TOP = '__pinned-top__';
const PIN_BOTTOM = '__pinned-bottom__';

function makerKeyFor(option) {
  if (!option) return 'other';
  if (option.pin) return 'other'; // specials get the neutral mark
  return option.maker || modelMaker(option.value, option.label).key;
}

export function ModelSelect({
  value,
  onValueChange,
  // Fires on open and on close, same contract as Select — callers refresh
  // `options` on open and the popup reconciles in place.
  onOpenChange,
  options = [],
  placeholder = 'Select model',
  searchPlaceholder = 'Search',
  emptyText = 'No models found',
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
  const entries = useMemo(() => options.filter(Boolean), [options]);

  const items = useMemo(() => {
    const top = entries.filter((o) => o.pin === 'top');
    const bottom = entries.filter((o) => o.pin === 'bottom');
    const grouped = groupModelOptions(entries.filter((o) => !o.pin));
    return [
      ...(top.length ? [{ key: PIN_TOP, name: null, items: top }] : []),
      ...grouped,
      ...(bottom.length ? [{ key: PIN_BOTTOM, name: null, items: bottom }] : []),
    ];
  }, [entries]);

  // The controlled selection as an item object (Combobox deals in items,
  // call sites deal in string ids). A value with no matching option still
  // renders on the trigger via a synthesized entry — same resilience the
  // composer needs when the saved model vanished from the list.
  const selected = useMemo(() => {
    if (value == null || value === '') return null;
    return entries.find((o) => o.value === value) || { value, label: String(value) };
  }, [entries, value]);

  const { contains } = Combobox.useFilter();

  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(item) => onValueChange?.(item ? item.value : '')}
      onOpenChange={onOpenChange}
      isItemEqualToValue={(a, b) => a?.value === b?.value}
      itemToStringLabel={(item) => item?.label ?? ''}
      // Match on the display label OR the raw id, across every group at
      // once — "opus" finds Claude Opus whether typed as alias or name.
      filter={(item, query) => contains(item?.label ?? '', query) || contains(item?.value ?? '', query)}
      autoHighlight
      disabled={disabled}
      id={id}
    >
      <Combobox.Trigger
        className={cn(variant === 'unstyled' ? null : triggerVariants({ variant, size }), className)}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-busy={loading || undefined}
        title={title}
        style={{ width, minWidth, ...style }}
        {...rest}
      >
        <span className="flex items-center gap-[8px] min-w-0">
          {selected && <ProviderIcon maker={makerKeyFor(selected)} className="text-ink-2" />}
          <span className={cn('truncate', !selected && 'text-ink-4')}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <span className="inline-flex shrink-0 text-ink-3">
          {loading ? <Spinner style={{ color: 'currentColor' }} /> : CARET_UP_DOWN}
        </span>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Backdrop className="fixed inset-0" />
        <Combobox.Positioner
          className="box-border outline-none"
          sideOffset={6}
          align="start"
          style={{ zIndex }}
        >
          <Combobox.Popup
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
              <Combobox.Input
                placeholder={searchPlaceholder}
                aria-label="Search models"
                className="flex-1 min-w-0 border-0 bg-transparent p-0 outline-none font-body text-[13px] text-ink placeholder:text-ink-4"
              />
            </div>
            <Combobox.Empty className="px-[14px] py-[10px] text-[12.5px] text-ink-4">
              {emptyText}
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(320px,calc(var(--available-height,320px)-44px))] overflow-y-auto overscroll-contain py-[4px] outline-none empty:p-0">
              {(group) => (
                <Combobox.Group key={group.key} items={group.items}>
                  {group.name && (
                    <Combobox.GroupLabel className="pt-[8px] px-[14px] pb-[3px] text-[11.5px] text-ink-4 select-none">
                      {group.name}
                    </Combobox.GroupLabel>
                  )}
                  <Combobox.Collection>
                    {(item) => (
                      <Combobox.Item
                        key={item.value}
                        value={item}
                        disabled={item.disabled}
                        title={item.title}
                        className={cn(
                          'grid grid-cols-[16px_1fr] items-center gap-[6px]',
                          'w-[calc(100%-8px)] mx-[4px] px-[10px] py-[7px] rounded-[5px]',
                          'text-[13px] text-ink-2 cursor-pointer select-none outline-none box-border',
                          'data-[highlighted]:bg-surface-2',
                          'data-[disabled]:opacity-55 data-[disabled]:cursor-not-allowed',
                        )}
                      >
                        <span className="inline-flex justify-center text-accent">
                          <Combobox.ItemIndicator>{CHECK}</Combobox.ItemIndicator>
                        </span>
                        <span className="min-w-0 truncate">{item.label}</span>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

export default ModelSelect;
