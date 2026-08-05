// Switch — an accessible on/off control.
//
// Built on Base UI's Switch for proper role="switch" semantics,
// keyboard handling (Space to toggle), and focus management.
// Styled with cva to match the existing .toggle appearance.
//
//   <Switch checked={on} onCheckedChange={setOn} />
//   <Switch checked={on} onCheckedChange={setOn} size="sm" />

import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const trackVariants = cva(
  'relative inline-flex shrink-0 cursor-pointer rounded-full border-0 p-0.5 transition-colors duration-150',
  {
    variants: {
      size: {
        sm: 'h-[18px] w-[32px]',
        md: 'h-[22px] w-[38px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

const thumbVariants = cva(
  'block rounded-full bg-white shadow-sm transition-[left] duration-150 absolute top-0.5',
  {
    variants: {
      size: {
        sm: 'h-3.5 w-3.5 left-0.5 data-[checked]:left-[16px]',
        md: 'h-[18px] w-[18px] left-0.5 data-[checked]:left-[18px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

export interface SwitchProps extends VariantProps<typeof trackVariants> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  title?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  size,
  className,
  ...rest
}: SwitchProps) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        trackVariants({ size }),
        checked ? 'bg-[var(--primary-700)]' : 'bg-[var(--stone-300)]',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      <BaseSwitch.Thumb className={cn(thumbVariants({ size }))} />
    </BaseSwitch.Root>
  );
}

export default Switch;
