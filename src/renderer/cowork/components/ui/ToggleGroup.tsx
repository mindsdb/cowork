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
//   <ToggleGroup disabled={busy} ... />
//
// The selected fill is one pill that slides to the chosen option rather than
// each option painting its own, so a change reads as motion, not a swap.

import { Fragment, useLayoutEffect, useRef, useState } from 'react';
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
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function ToggleGroup({
  value,
  onValueChange,
  options,
  size = 'md',
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: ToggleGroupProps) {
  const cs = CONTAINER_SIZE[size] ?? CONTAINER_SIZE.md;
  const is = ITEM_SIZE[size] ?? ITEM_SIZE.md;
  const groupRef = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  // The pill lands without sliding on first paint; only later moves animate.
  const [settled, setSettled] = useState(false);

  // Measured, not computed: option widths change when labels hide at narrow
  // widths, so the pill follows the group's size as well as the selection.
  useLayoutEffect(() => {
    const group = groupRef.current;
    const measure = () => {
      const el = items.current.get(value);
      // No layout (hidden, or a DOM without one): the option paints its own fill.
      setPill(el && el.offsetWidth ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    if (!group || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [value, options.length]);
  useLayoutEffect(() => {
    if (!pill || settled) return undefined;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [pill, settled]);

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
      disabled={disabled}
      ref={groupRef}
      className={cn('relative inline-flex items-center', disabled && 'opacity-[0.55]', className)}
      style={{
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
      }}
      aria-label={ariaLabel}
    >
      {pill && (
        <span
          aria-hidden="true"
          data-toggle-pill=""
          style={{
            position: 'absolute',
            left: 0,
            top: cs.padding,
            bottom: cs.padding,
            width: pill.w,
            transform: `translateX(${pill.x}px)`,
            borderRadius: is.borderRadius,
            background: 'var(--toggle-selected-bg, var(--surface-3))',
            boxShadow: 'var(--toggle-selected-shadow, inset 0 0 0 1px var(--line-2))',
            transition: settled
              ? 'transform var(--dur-layout) var(--ease-out), width var(--dur-layout) var(--ease-out)'
              : 'none',
          }}
        />
      )}
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
                  transition: 'opacity var(--dur-hover) ease',
                }}
              />
            )}
            <BaseToggle
              value={opt.value}
              ref={(el: HTMLElement | null) => {
                if (el) items.current.set(opt.value, el);
                else items.current.delete(opt.value);
              }}
              aria-label={opt['aria-label'] || opt.title}
              title={opt.title}
              // Ink lives in classes, not the style below, so an unselected
              // option can darken a step on hover.
              className={cn(
                'relative inline-flex items-center gap-[6px] text-ink-3 data-[pressed]:text-ink',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:text-ink-2',
              )}
              style={(state: { pressed: boolean }) => ({
                padding: is.padding,
                borderRadius: is.borderRadius,
                fontFamily: 'var(--font-body)',
                fontSize: is.fontSize,
                border: 0,
                background: state.pressed && !pill
                  ? 'var(--toggle-selected-bg, var(--surface-3))'
                  : 'transparent',
                boxShadow: state.pressed && !pill
                  ? 'var(--toggle-selected-shadow, inset 0 0 0 1px var(--line-2))'
                  : 'none',
                transition: 'background var(--dur-hover) ease, color var(--dur-hover) ease',
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
