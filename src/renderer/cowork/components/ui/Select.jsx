// `<Select>` — token-skinned dropdown select built on Base UI.
//
// Why a library here: the hand-rolled selects across the app were either
// bare native `<select>` elements (inconsistent padding/chevron per call
// site) or a "transparent `<select>` overlaid on a styled pill" trick
// (ConnectorPicker's `SelectPill`, the ConnectWorkflowView filter/sort
// controls) that fakes a custom look while keeping the OS popup — fine
// until you want consistent styling, real keyboard support, or a divider
// between options. Base UI's Select gives us a fully custom, accessible
// popup (arrow keys, typeahead, focus management) while we own only the
// skin, wired to the same design tokens (`bg-surface`, `text-ink-2`,
// `border-line`, …) the rest of the app uses.
//
// Styled with `cva` + `cn()` + Tailwind's `data-[]:`/`aria-[]:` arbitrary
// variants — the pattern `Switch.tsx`/`Checkbox.tsx` already established
// for skinning Base UI's data-attribute-driven states (highlighted,
// disabled, selected, open/closed). Not a runtime-injected stylesheet:
// Tailwind's own pipeline sees and processes every class here, same as
// any other component.
//
// API is options-array driven (mirrors `Menu`'s `items` prop) rather than
// compound children — nearly every call site already builds its options
// via `.map()` over an existing list, so handing in that array is less
// code than wrapping each entry in a `<Select.Item>`.
//
//   <Select
//     value={sortBy}
//     onValueChange={setSortBy}
//     options={[
//       { value: 'name', label: 'Name' },
//       { value: 'date', label: 'Date' },
//       { separator: true },
//       { value: 'x', label: 'X', disabled: true },
//     ]}
//   />
//
// Option shape: { value, label, disabled?, title? }. `{ separator: true }`
// renders a divider. `{ group, options }` renders a labeled group (only
// used if a call site needs it — none currently do).
//
// Two visual variants:
//   - `variant="field"` (default) — full-width bordered control, matches
//     the form fields it replaces (settings-select, channels-input, etc).
//   - `variant="pill"` — compact "Label: value ⌄" control, replaces the
//     SelectPill / customize-select overlay trick used for sort/filter.

import { useMemo } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import Spinner from './Spinner.jsx';

const triggerVariants = cva(
  [
    'inline-flex items-center justify-between gap-[10px]',
    // `border-solid` is load-bearing, not redundant: preflight is disabled
    // (tailwind.config.js), so nothing resets the trigger `<button>`'s UA
    // default `border-style: outset`. Tailwind's `border` sets only width,
    // `border-line` only color — without this the 1px border renders
    // beveled/uneven instead of a clean line.
    'font-body bg-surface border border-solid border-line rounded-[var(--r)] text-ink',
    'cursor-pointer outline-none box-border',
    '[transition:border-color_.12s_ease,box-shadow_.15s_ease]',
    'hover:border-line-2',
    'focus-visible:border-accent focus-visible:shadow-[var(--ring)]',
    'data-[disabled]:opacity-55 data-[disabled]:cursor-not-allowed',
    'aria-[invalid=true]:border-[#E07060] aria-[invalid=true]:shadow-[0_0_0_1px_rgba(224,112,96,0.45)]',
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
      // Only the field variant has a distinct "sm" size — a pill's size
      // is fixed regardless of `size` (matches the original hand-rolled
      // SelectPill, which never took a size prop).
      { variant: 'field', size: 'sm', class: 'px-[8px] py-[5px] text-[12px]' },
    ],
    defaultVariants: { variant: 'field', size: 'md' },
  },
);

const CHEVRON_DOWN = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CHECK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Flattens the options tree (unwrapping groups, dropping separators) into
// the `{ value, label }` pairs Base UI's Root `items` prop wants — that's
// what lets `<Select.Value>` resolve the selected item's label instead of
// echoing back the raw value.
function flattenForLabels(options) {
  const out = [];
  for (const opt of options) {
    if (!opt || opt.separator) continue;
    if (Array.isArray(opt.options)) {
      out.push(...flattenForLabels(opt.options));
      continue;
    }
    out.push({ value: opt.value, label: opt.label });
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
        <BaseSelect.ItemText className="flex-1 min-w-0 truncate">{opt.label}</BaseSelect.ItemText>
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
  // Fires on open and on close. For a caller that wants to refresh `options`
  // when the popup opens; the popup opens straight away either way, so the
  // new options land in place rather than gating the open on a fetch.
  onOpenChange,
  options = [],
  placeholder = 'Select…',
  // "field" = full-width bordered control (form fields).
  // "pill"  = compact "Label: value ⌄" control (sort/filter selectors).
  variant = 'field',
  size = 'md',
  disabled = false,
  // Swaps the chevron for a spinner — for a caller re-fetching `options`
  // (e.g. on open) so the trigger reflects "still loading" instead of
  // silently showing possibly-stale data for the fetch's duration.
  loading = false,
  // Sets aria-invalid + a danger-tinted ring on the trigger.
  invalid = false,
  // Pill-variant prefix, e.g. "Sort by". Falls back to `ariaLabel` when
  // omitted so a pill always has an accessible name.
  label,
  ariaLabel,
  title,
  id,
  name,
  width,
  minWidth,
  className,
  style,
  zIndex = 95,
  // Escape hatch — forwarded straight to the trigger button (e.g.
  // `aria-describedby` to associate an inline error message).
  ...rest
}) {
  const itemsForLabels = useMemo(() => flattenForLabels(options), [options]);

  return (
    <BaseSelect.Root
      value={value}
      items={itemsForLabels}
      onValueChange={(next) => onValueChange?.(next)}
      onOpenChange={onOpenChange}
      disabled={disabled}
      id={id}
      name={name}
    >
      <BaseSelect.Trigger
        className={cn(triggerVariants({ variant, size }), className)}
        aria-label={ariaLabel || label}
        aria-invalid={invalid || undefined}
        // The spinner that replaces the chevron is aria-hidden, so without
        // this a screen-reader user gets no signal that a click is being
        // worked on and the popup just hasn't opened yet.
        aria-busy={loading || undefined}
        title={title}
        style={{ width, minWidth, ...style }}
        {...rest}
      >
        {variant === 'pill' && (label || ariaLabel) && (
          <span className="text-ink-4 text-[11.5px]">{label || ariaLabel}:</span>
        )}
        <BaseSelect.Value placeholder={placeholder} className="truncate" />
        <BaseSelect.Icon className="inline-flex shrink-0 text-ink-3">
          {loading ? <Spinner style={{ color: 'currentColor' }} /> : CHEVRON_DOWN}
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
            className={cn(
              'min-w-[var(--anchor-width,_160px)] max-h-[var(--available-height,_320px)] overflow-y-auto',
              // Bordered popup matching Menu's look (same var(--surface) bg,
              // 1px var(--line) border, 10px radius). `border-solid` is
              // load-bearing, not redundant: preflight is disabled, so a bare
              // `border` on this <div> sets width but leaves border-style at
              // the UA default `none` — which forces the used border-width to
              // 0, i.e. no border renders at all. Without the border a
              // borderless popup on the light Settings surface has only the
              // soft shadow-sh-popup to separate it from the background, and
              // its top edge all but vanishes. (When ENG-790 lands it drops
              // borders from every popup — Menu and Select together — so
              // matching Menu today keeps the two in lockstep either way.)
              'bg-surface border border-solid border-line rounded-[10px] shadow-sh-popup py-[4px] outline-none font-body',
              '[transform-origin:var(--transform-origin)]',
              'data-[open]:animate-scale-in data-[closed]:animate-scale-out',
            )}
          >
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
