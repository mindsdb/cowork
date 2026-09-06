// Searchable picker with an input inside the popup; domain pickers supply groups and presentation.
// Groups: { key, name, items }; name: null omits the heading.
// Items: { value, label, disabled?, title?, icon?, tag?, ... }; extra fields reach filters and
// renderers.
// filter(item, query, contains) overrides label/value matching; contains is locale-aware.
// renderValue(selected) overrides the trigger. footer is a React node outside item filtering and
// keyboard navigation;
// its content owns actions and closing through controlled open/onOpenChange.

import { useMemo } from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { ChevronsUpDown, Check, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import Spinner from './Spinner.jsx';
import { PickerMenuHeading, triggerVariants } from './Select.jsx';

const CARET_UP_DOWN = <ChevronsUpDown size={11} strokeWidth={1.5} aria-hidden="true" />;

const CHECK = <Check size={12} strokeWidth={1.5} aria-hidden="true" />;

const SEARCH = <Search size={14} strokeWidth={1.5} aria-hidden="true" />;

export function Combobox({
  value,
  onValueChange,
  // Controlled open state; omit for an uncontrolled popup.
  open,
  // Fires on open and close; options can refresh while the popup stays open.
  onOpenChange,
  groups = [],
  filter,
  renderValue,
  footer,
  placeholder = 'Select',
  searchPlaceholder = 'Search',
  searchAriaLabel = 'Search',
  menuLabel,
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
  // Freeze placement at open so trigger resizing cannot move the popup. It will not track scroll or
  // resize.
  disableAnchorTracking = false,
  ...rest
}) {
  const entries = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Synthesize an item for a saved value missing from the options so the trigger still shows it.
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
        aria-description={selected?.label ? `Selected: ${selected.label}` : undefined}
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
          disableAnchorTracking={disableAnchorTracking}
        >
          <BaseCombobox.Popup
            className={cn(
              'flex flex-col overflow-hidden w-[max(var(--anchor-width),240px)] max-w-[var(--available-width)]',
              // Preflight is disabled; border-solid is required for a visible border.
              'bg-surface border border-solid border-line rounded-[10px] shadow-sh-popup outline-none font-body',
              '[transform-origin:var(--transform-origin)]',
              'data-[open]:animate-scale-in data-[closed]:animate-scale-out',
            )}
          >
            <PickerMenuHeading>{menuLabel}</PickerMenuHeading>
            {/*
 * Zero other border widths: with preflight disabled, border-solid otherwise restores the UA medium
 * border.
 */}
            <div className="flex items-center gap-[8px] px-[12px] py-[9px] border-solid border-line border-b border-t-0 border-x-0 text-ink-4">
              {SEARCH}
              <BaseCombobox.Input
                placeholder={searchPlaceholder}
                aria-label={searchAriaLabel}
                className="flex-1 min-w-0 border-0 bg-transparent p-0 outline-none font-body text-[13px] text-ink placeholder:text-ink-4"
              />
            </div>
            {/* Base UI retains the empty live-region root; hide its padding when there are results. */}
            <BaseCombobox.Empty className="empty:p-0 px-[14px] py-[10px] text-[12.5px] text-ink-4">
              {emptyText}
            </BaseCombobox.Empty>
            <BaseCombobox.List
              // Reserve footer height inside the list cap so mounting a footer cannot move an
              // above-trigger popup.
              className={cn(
                footer
                  ? 'max-h-[min(280px,calc(var(--available-height,320px)-84px))]'
                  : 'max-h-[min(320px,calc(var(--available-height,320px)-44px))]',
                'overflow-y-auto overscroll-contain py-[4px] outline-none empty:p-0',
              )}
            >
              {(group) => (
                <BaseCombobox.Group key={group.key} items={group.items} className={group.className}>
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
                          (item.icon || item.tag || item.action) ? 'grid-cols-[16px_1fr_auto]' : 'grid-cols-[16px_1fr]',
                          'w-[calc(100%-8px)] mx-[4px] px-[10px] py-[7px] rounded-[5px]',
                          'text-[13px] text-ink-2 cursor-pointer select-none outline-none box-border',
                          'data-[highlighted]:bg-surface-2',
                          'data-[disabled]:opacity-55 data-[disabled]:cursor-not-allowed',
                        )}
                      >
                        <span className={cn('inline-flex justify-center', item.icon ? 'text-ink-3' : 'text-accent')}>
                          {item.icon || <BaseCombobox.ItemIndicator>{CHECK}</BaseCombobox.ItemIndicator>}
                        </span>
                        <span className="min-w-0 truncate">{item.label}</span>
                        {(item.icon || item.tag || item.action) && (
                          <span className="shrink-0 flex items-center gap-[6px]">
                            {item.tag && (
                              <span className="rounded-full border border-line px-[7px] py-[1px] text-[10.5px] leading-[15px] text-ink-4 select-none">
                                {item.tag}
                              </span>
                            )}
                            {/* Trailing action handlers must stopPropagation to avoid also selecting the item. */}
                            {item.action}
                            {item.icon && (
                              <span className="inline-flex text-accent">
                                <BaseCombobox.ItemIndicator>{CHECK}</BaseCombobox.ItemIndicator>
                              </span>
                            )}
                          </span>
                        )}
                      </BaseCombobox.Item>
                    )}
                  </BaseCombobox.Collection>
                </BaseCombobox.Group>
              )}
            </BaseCombobox.List>
            {footer && (
              // Fade only: the footer already changes the list height.
              <div className="border-solid border-line border-t border-b-0 border-x-0 animate-fade-in">
                {footer}
              </div>
            )}
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}

export default Combobox;
