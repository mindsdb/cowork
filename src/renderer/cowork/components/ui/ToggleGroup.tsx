import { Fragment } from 'react';
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { cn } from '../../lib/cn';

// Keep toolbar control heights aligned with SearchInput and SortPill.
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
        // Ignore the empty array emitted when clicking the active item: one option must remain
        // selected.
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
        // Hide dividers touching the selection so they do not cut across its fill; retain their
        // space to avoid reflow.
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
