// Checkbox — an accessible ticked/unticked control.
//
// Built on Base UI's Checkbox (role, Space-to-toggle, focus, hidden form
// input) and styled to the design system to match Switch's visual language
// (cva + cn + CSS vars + data-[checked]). Replaces ad-hoc native
// `<input type="checkbox">` with one consistent, branded, accessible box.
//
//   <Checkbox checked={on} onCheckedChange={setOn} />
//   <Checkbox checked={on} onCheckedChange={setOn} size="sm" disabled />

import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const boxVariants = cva(
  // `border-solid` is explicit because this app disables Tailwind's preflight
  // (which is what normally sets `border-style: solid`) — without it the
  // `border` utility sets a width but no style, so the box renders borderless
  // and the unchecked state is invisible against a light surface.
  'inline-flex shrink-0 items-center justify-center rounded-[4px] border border-solid cursor-pointer outline-none transition-colors duration-150',
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

export interface CheckboxProps extends VariantProps<typeof boxVariants> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  indeterminate?: boolean;
  id?: string;
  name?: string;
  className?: string;
  'aria-label'?: string;
}

export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  indeterminate,
  id,
  name,
  size,
  className,
  ...rest
}: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      id={id}
      name={name}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(next) => onCheckedChange?.(next)}
      disabled={disabled}
      indeterminate={indeterminate}
      className={cn(
        boxVariants({ size }),
        'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink-3)]',
        'data-[checked]:border-[var(--primary-700)] data-[checked]:bg-[var(--primary-700)] data-[checked]:text-white',
        'data-[indeterminate]:border-[var(--primary-700)] data-[indeterminate]:bg-[var(--primary-700)] data-[indeterminate]:text-white',
        'focus-visible:ring-2 focus-visible:ring-[var(--primary-700)]/40',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center">
        {indeterminate ? (
          <Minus size={size === 'sm' ? 10 : 12} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Check size={size === 'sm' ? 10 : 12} strokeWidth={1.5} aria-hidden="true" />
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

export default Checkbox;
