// RadioGroup — one choice from a short list of options.
//
// Built on Base UI's RadioGroup + Radio (role="radiogroup"/"radio",
// arrow-key roving selection, hidden form input) and styled to match
// Checkbox (cva + cn + CSS vars + data-[checked]). Replaces hand-rolled
// native `<input type="radio">` rows and `role="radio"` buttons with a
// painted indicator.
//
//   <RadioGroup value={mode} onValueChange={setMode} aria-label="Mode">
//     <Radio value="fast" className="my-option-row">
//       <span><strong>Fast</strong><small>Fewer checks</small></span>
//     </Radio>
//     <Radio value="safe" className="my-option-row" indicator="end">…</Radio>
//   </RadioGroup>
//
// A Radio with children is the whole clickable row: the indicator sits at
// its start (or `indicator="end"`) and the children are its accessible name.
// The row carries no layout of its own — callers pass a layout class — but
// exposes `data-checked` / `data-disabled` for selected-row styling.
// Base UI radios are spans, so a surrounding `<fieldset disabled>` does not
// reach them: pass `disabled` to the group or the radio instead.

import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { Radio as BaseRadio } from '@base-ui/react/radio';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

const indicatorVariants = cva(
  // `border-solid` is explicit because this app disables Tailwind's preflight
  // (see Checkbox) — without it the unchecked ring would not render.
  'inline-flex shrink-0 items-center justify-center rounded-full border border-solid transition-colors duration-150',
  {
    variants: {
      size: {
        sm: 'h-4 w-4',
        md: 'h-[18px] w-[18px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
  children: ReactNode;
  // Layout-only escape hatch (appended via cn).
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export function RadioGroup({ onValueChange, className, children, ...rest }: RadioGroupProps) {
  return (
    <BaseRadioGroup
      onValueChange={(next) => onValueChange?.(next as string)}
      className={className}
      {...rest}
    >
      {children}
    </BaseRadioGroup>
  );
}

export interface RadioProps extends VariantProps<typeof indicatorVariants> {
  value: string;
  disabled?: boolean;
  // Row content; omit for a bare indicator.
  children?: ReactNode;
  indicator?: 'start' | 'end';
  className?: string;
  'aria-label'?: string;
}

export function Radio({ value, disabled, size, indicator = 'start', children, className, ...rest }: RadioProps) {
  const dot = (
    <span
      aria-hidden="true"
      className={cn(
        indicatorVariants({ size }),
        // Nudge a leading dot onto the first text line of a multi-line row.
        children != null && indicator === 'start' && 'mt-0.5',
        'border-[var(--border-strong)] bg-[var(--surface)]',
        'group-data-[checked]:border-[var(--primary-700)] group-data-[checked]:bg-[var(--primary-700)]',
      )}
    >
      <BaseRadio.Indicator className="block h-1.5 w-1.5 rounded-full bg-white" />
    </span>
  );
  return (
    <BaseRadio.Root
      value={value}
      disabled={disabled}
      className={cn(
        'group cursor-pointer outline-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        children == null && 'inline-flex rounded-full',
        className,
      )}
      {...rest}
    >
      {indicator === 'end' ? <>{children}{dot}</> : <>{dot}{children}</>}
    </BaseRadio.Root>
  );
}

export default RadioGroup;
