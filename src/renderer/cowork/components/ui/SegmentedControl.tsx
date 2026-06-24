// SegmentedControl — a row of mutually exclusive options.
//
// Built on Base UI's ToggleGroup for proper radiogroup semantics
// and keyboard navigation (arrow keys, Home/End).
//
//   <SegmentedControl
//     value="grid"
//     onValueChange={setView}
//     options={[
//       { value: 'grid', label: 'Grid' },
//       { value: 'list', label: 'List' },
//     ]}
//   />
//
//   <SegmentedControl size="sm" ... />

import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const rootVariants = cva(
  'inline-flex items-center gap-0 rounded-lg border border-line bg-surface-2 p-0.5',
  {
    variants: {
      size: {
        sm: 'rounded-md',
        md: '',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

const itemVariants = cva(
  [
    'inline-flex items-center justify-center border-0 font-body font-medium',
    'cursor-pointer transition-all duration-100',
    'text-ink-3',
    'data-[pressed]:bg-surface-3 data-[pressed]:text-ink data-[pressed]:shadow-sm',
  ],
  {
    variants: {
      size: {
        sm: 'h-6 rounded px-2 text-[11px]',
        md: 'h-7 rounded-md px-3 text-[12.5px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  'aria-label'?: string;
}

export interface SegmentedControlProps extends VariantProps<typeof rootVariants> {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedOption[];
  className?: string;
  'aria-label'?: string;
}

export function SegmentedControl({
  value,
  onValueChange,
  options,
  size,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(newValue) => {
        // ToggleGroup returns an array; we want single-select behavior.
        // When clicking the already-active item, newValue removes it
        // (empty array) — ignore that to keep one always selected.
        const next = newValue.find((v) => v !== value);
        if (next) onValueChange(next);
      }}
      className={cn(rootVariants({ size }), className)}
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <BaseToggle
          key={opt.value}
          value={opt.value}
          aria-label={opt['aria-label'] || opt.title}
          title={opt.title}
          className={cn(itemVariants({ size }))}
        >
          {opt.icon && <span className="mr-1.5 inline-flex">{opt.icon}</span>}
          {opt.label}
        </BaseToggle>
      ))}
    </ToggleGroup>
  );
}

export default SegmentedControl;
