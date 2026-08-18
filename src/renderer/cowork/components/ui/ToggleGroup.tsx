// ToggleGroup — a row of mutually exclusive options.
//
// Built on Base UI's ToggleGroup for proper radiogroup semantics
// and keyboard navigation (arrow keys, Home/End).
//
//   <ToggleGroup
//     value="grid"
//     onValueChange={setView}
//     options={[
//       { value: 'grid', label: 'Grid' },
//       { value: 'list', label: 'List' },
//     ]}
//   />
//
//   <ToggleGroup size="sm" ... />

import { Fragment } from 'react';
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { cn } from '../../lib/cn';

// Outer container sizes mirror toolbar controls (SearchInput / SortPill).
// Container padding (2px) + item vertical padding + font line-height ≈ same
// total height as a SortPill with padding: 7px 11px.
const CONTAINER_SIZE = {
  md: { padding: 2,     borderRadius: 7 },
  sm: { padding: 1,     borderRadius: 5 },
};
const ITEM_SIZE = {
  md: { padding: '5px 10px', borderRadius: 5, fontSize: 12.5, dividerHeight: 12 },
  sm: { padding: '3px 7px',  borderRadius: 3, fontSize: 11,   dividerHeight: 10 },
};

export interface ToggleGroupOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  'aria-label'?: string;
}

export interface ToggleGroupProps {
  value: string;
  onValueChange: (value: string) => void;
  options: ToggleGroupOption[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function ToggleGroup({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: ToggleGroupProps) {
  const cs = CONTAINER_SIZE[size] ?? CONTAINER_SIZE.md;
  const is = ITEM_SIZE[size] ?? ITEM_SIZE.md;

  return (
    <BaseToggleGroup
      value={[value]}
      onValueChange={(newValue) => {
        // BaseToggleGroup returns an array; we want single-select behavior.
        // When clicking the already-active item, newValue removes it
        // (empty array) — ignore that to keep one always selected.
        const next = newValue.find((v) => v !== value);
        if (next) onValueChange(next);
      }}
      className={cn('inline-flex items-center', className)}
      style={{
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
      }}
      aria-label={ariaLabel}
    >
      {options.map((opt, i) => {
        // A divider between two UNselected neighbors reads as a segmented
        // control; between a selected item and its neighbor it would cut
        // across the selected item's own background fill/shadow, which
        // looks like a stray line broken over the pill rather than a
        // separator — hidden (not removed, so nothing reflows) whenever
        // either side of the boundary is the current selection.
        const prev = options[i - 1];
        const dividerHidden = value === opt.value || (prev && value === prev.value);
        return (
          <Fragment key={opt.value}>
            {i > 0 && (
              <span
                aria-hidden="true"
                style={{
                  width: 1,
                  height: is.dividerHeight,
                  alignSelf: 'center',
                  // color-mix, not the bare token: a bit more subtle than a
                  // full-strength line between such small, tightly-packed
                  // items.
                  background: 'color-mix(in srgb, var(--line) 55%, transparent)',
                  opacity: dividerHidden ? 0 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              />
            )}
            <BaseToggle
              value={opt.value}
              aria-label={opt['aria-label'] || opt.title}
              title={opt.title}
              className="inline-flex items-center gap-[6px] cursor-pointer"
              style={(state: { pressed: boolean }) => ({
                padding: is.padding,
                borderRadius: is.borderRadius,
                fontFamily: 'var(--font-body)',
                fontSize: is.fontSize,
                border: 0,
                background: state.pressed
                  ? 'var(--toggle-selected-bg, var(--surface-3))'
                  : 'transparent',
                color: state.pressed ? 'var(--ink)' : 'var(--ink-3)',
                boxShadow: state.pressed
                  ? 'var(--toggle-selected-shadow, inset 0 0 0 1px var(--line-2))'
                  : 'none',
                transition: 'background 0.15s ease, color 0.15s ease',
              })}
            >
              {opt.icon && <span className="inline-flex">{opt.icon}</span>}
              {opt.label}
            </BaseToggle>
          </Fragment>
        );
      })}
    </BaseToggleGroup>
  );
}

export default ToggleGroup;
