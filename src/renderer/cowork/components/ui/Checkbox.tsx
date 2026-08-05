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
          <svg viewBox="0 0 12 12" width={size === 'sm' ? 10 : 12} height={size === 'sm' ? 10 : 12} aria-hidden>
            <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" width={size === 'sm' ? 10 : 12} height={size === 'sm' ? 10 : 12} fill="none" aria-hidden>
            <path d="M2.5 6.5 5 9l4.5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

export default Checkbox;
