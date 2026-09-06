// Options: { value, label, disabled?, title?, icon? }, { separator: true }, or { group, options }.
// Icons appear only in the popup; the trigger shows the label.
// Variants: field (bordered form control), pill (compact labelled control), unstyled (caller
// supplies the trigger style).

import { useMemo } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { ChevronDown, ChevronsUpDown, Check } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import Spinner from './Spinner.jsx';

// Shared with Combobox so their closed triggers match.
export const triggerVariants = cva(
  [
    'inline-flex items-center justify-between gap-[10px]',
    // Preflight is disabled; border-solid overrides the button's UA outset border.
    'font-body bg-surface border border-solid border-line rounded-[var(--r)] text-ink',
    'cursor-pointer outline-none box-border',
    '[transition:border-color_.12s_ease,box-shadow_.15s_ease]',
    'hover:border-line-2',
    'focus-visible:border-accent focus-visible:shadow-[var(--ring)]',
    'data-[disabled]:opacity-55 data-[disabled]:cursor-not-allowed',
    'aria-[invalid=true]:border-[var(--danger)] aria-[invalid=true]:shadow-[0_0_0_1px_var(--danger)]',
  ],
  {
    variants: {
      variant: {
        field: 'w-full px-[10px] py-[7px] text-[13px]',
        pill: 'rounded-[7px] px-[11px] py-[7px] bg-surface-2 text-ink-2 text-[12.5px]',
      },
      size: {
        md: '',
        sm: '',
      },
    },
    compoundVariants: [
      // Only field has a distinct sm size; pill size is fixed.
      { variant: 'field', size: 'sm', class: 'px-[8px] py-[5px] text-[12px]' },
    ],
    defaultVariants: { variant: 'field', size: 'md' },
  },
);

export function PickerMenuHeading({ children }) {
  if (!children) return null;
  return (
    <div className="px-[14px] pt-[9px] pb-[5px] text-[10.5px] font-semibold leading-[16px] text-ink-4 select-none">
      {children}
    </div>
  );
}

const CHEVRON_DOWN = <ChevronDown size={11} strokeWidth={1.5} aria-hidden="true" />;
const CARET_UP_DOWN = <ChevronsUpDown size={11} strokeWidth={1.5} aria-hidden="true" />;

const CHECK = <Check size={12} strokeWidth={1.5} aria-hidden="true" />;

// Root items let Select.Value resolve labels instead of displaying raw values.
function flattenForLabels(options) {
  const out = [];
  for (const opt of options) {
    if (!opt || opt.separator) continue;
    if (Array.isArray(opt.options)) {
      out.push(...flattenForLabels(opt.options));
      continue;
    }
    out.push({ value: opt.value, label: opt.triggerLabel ?? opt.label });
  }
  return out;
}

function renderOptions(options) {
  return options.filter(Boolean).map((opt, i) => {
    if (opt.separator) {
      return <BaseSelect.Separator key={`sep-${i}`} className="h-px bg-line my-[4px]" />;
    }

    if (Array.isArray(opt.options)) {
      return (
        <BaseSelect.Group key={opt.group ?? i}>
          <BaseSelect.GroupLabel className="pt-[6px] px-[14px] pb-[2px] text-[11px] font-semibold text-ink-4 uppercase tracking-[0.04em]">
            {opt.group}
          </BaseSelect.GroupLabel>
          {renderOptions(opt.options)}
        </BaseSelect.Group>
      );
    }

    return (
      <BaseSelect.Item
        key={opt.value}
        value={opt.value}
        disabled={opt.disabled}
        title={opt.title}
        className={cn(
          'group flex items-center gap-[8px]',
          'w-[calc(100%-8px)] mx-[4px] px-[10px] py-[8px] rounded-[5px]',
          'text-[13px] text-ink-2 cursor-pointer select-none outline-none box-border',
          'data-[highlighted]:bg-surface-2',
          'data-[disabled]:opacity-55 data-[disabled]:cursor-not-allowed',
        )}
      >
        {opt.icon && (
          <span className="inline-flex shrink-0 text-ink-3">{opt.icon}</span>
        )}
        <BaseSelect.ItemText className="flex-1 min-w-0">
          <span className="block truncate">{opt.label}</span>
          {opt.description && (
            <span className="block mt-[2px] truncate text-[11px] leading-[14px] font-normal text-ink-4">
              {opt.description}
            </span>
          )}
        </BaseSelect.ItemText>
        {opt.meta && (
          <span className="inline-flex shrink-0 text-[10.5px] text-ink-4">{opt.meta}</span>
        )}
        <span className="inline-flex shrink-0 text-accent invisible group-data-[selected]:visible">
          <BaseSelect.ItemIndicator>{CHECK}</BaseSelect.ItemIndicator>
        </span>
      </BaseSelect.Item>
    );
  });
}

export function Select({
  value,
  onValueChange,
  // Controlled open state; omit for the usual uncontrolled popup.
  open,
  // Fires on open and close; refresh options without delaying popup opening.
  onOpenChange,
  options = [],
  placeholder = 'Select…',
  variant = 'field',
  size = 'md',
  disabled = false,
  // Replace the chevron while options are loading.
  loading = false,
  invalid = false,
  // Pill prefix; falls back to ariaLabel for an accessible name.
  label,
  // Popup-only identity for controls whose closed trigger is terse.
  menuLabel,
  ariaLabel,
  title,
  id,
  name,
  width,
  minWidth,
  // Minimum popup width; otherwise matches the trigger.
  menuMinWidth,
  className,
  style,
  zIndex = 95,
  // Props forwarded to the trigger, including aria-describedby.
  ...rest
}) {
  const itemsForLabels = useMemo(() => flattenForLabels(options), [options]);
  const selectedLabel = itemsForLabels.find((item) => item.value === value)?.label;

  return (
    <BaseSelect.Root
      value={value}
      items={itemsForLabels}
      onValueChange={(next) => onValueChange?.(next)}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      id={id}
      name={name}
    >
      <BaseSelect.Trigger
        // unstyled leaves visual treatment entirely to the caller's className.
        className={cn(variant === 'unstyled' ? null : triggerVariants({ variant, size }), className)}
        aria-label={ariaLabel || label}
        aria-description={(typeof selectedLabel === 'string' || typeof selectedLabel === 'number')
          ? `Selected: ${selectedLabel}`
          : undefined}
        aria-invalid={invalid || undefined}
        // The spinner is aria-hidden; expose loading separately to screen readers.
        aria-busy={loading || undefined}
        title={title}
        style={{ width, minWidth, ...style }}
        {...rest}
      >
        {variant === 'pill' && (label || ariaLabel) && (
          <span className="text-ink-4 text-[11.5px]">{label || ariaLabel}:</span>
        )}
        <BaseSelect.Value placeholder={placeholder} className="truncate data-[placeholder]:text-ink-4" />
        <BaseSelect.Icon className="inline-flex shrink-0 text-ink-3">
          {loading
            ? <Spinner style={{ color: 'currentColor' }} />
            : variant === 'unstyled' ? CARET_UP_DOWN : CHEVRON_DOWN}
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Backdrop className="fixed inset-0" />
        <BaseSelect.Positioner
          className="box-border outline-none"
          sideOffset={6}
          alignItemWithTrigger={false}
          style={{ zIndex }}
        >
          <BaseSelect.Popup
            style={menuMinWidth === undefined ? undefined : { minWidth: menuMinWidth }}
            className={cn(
              'min-w-[var(--anchor-width,_160px)] max-h-[var(--available-height,_320px)] overflow-y-auto',
              // Preflight is disabled; border-solid is required for a visible popup border.
              'bg-surface border border-solid border-line rounded-[10px] shadow-sh-popup py-[4px] outline-none font-body',
              '[transform-origin:var(--transform-origin)]',
              'data-[open]:animate-scale-in data-[closed]:animate-scale-out',
            )}
          >
            <PickerMenuHeading>{menuLabel}</PickerMenuHeading>
            <BaseSelect.List>
              {renderOptions(options)}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

export default Select;
