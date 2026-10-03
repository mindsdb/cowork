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
// The plain row carries no layout of its own. `variant="card"` is the
// bordered option row used for choices with a title and description: the
// primitive owns its border, padding, hover and the one selected style, so
// callers only lay out what goes inside.
//
//   <Radio value="include" variant="card" size="sm">
//     <span><strong>Include my local changes</strong><small>…</small></span>
//   </Radio>
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

const rowVariants = cva('group cursor-pointer outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50', {
  variants: {
    variant: {
      plain: '',
      card: cn(
        // Same preflight caveat as the indicator: `border-solid` is explicit.
        'flex w-full items-start gap-2.5 rounded-card-row border border-solid border-line bg-transparent p-3 text-left text-ink',
        'transition-colors duration-150 [&:not([data-checked])]:hover:bg-surface-2',
        'data-[checked]:border-accent data-[checked]:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]',
      ),
    },
  },
  defaultVariants: { variant: 'plain' },
});

export interface RadioProps extends VariantProps<typeof indicatorVariants>, VariantProps<typeof rowVariants> {
  value: string;
  disabled?: boolean;
  // Row content; omit for a bare indicator.
  children?: ReactNode;
  indicator?: 'start' | 'end';
  className?: string;
  'aria-label'?: string;
}

export function Radio({ value, disabled, size, variant, indicator = 'start', children, className, ...rest }: RadioProps) {
  const dot = (
    <span
      aria-hidden="true"
      className={cn(
        indicatorVariants({ size }),
        // Nudge the dot onto the first text line of a multi-line row.
        children != null && (indicator === 'start' || variant === 'card') && 'mt-0.5',
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
        rowVariants({ variant }),
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
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
