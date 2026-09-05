// Use variant for visual treatment; className is for layout only. Styles live in globals.css.

import { forwardRef } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentPropsWithoutRef, ComponentRef } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'subtle' | 'tinted' | 'danger' | 'danger-solid';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps
  extends Omit<ComponentPropsWithoutRef<typeof BaseButton>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  block?: boolean;
  className?: string;
}

const VARIANTS = new Set<ButtonVariant>(['default', 'primary', 'subtle', 'tinted', 'danger', 'danger-solid']);
const SIZES = new Set<ButtonSize>(['xs', 'sm', 'md', 'lg', 'xl']);

const Button = forwardRef<ComponentRef<typeof BaseButton>, ButtonProps>(function Button({
  variant = 'default',
  size = 'md',
  icon = false,
  block = false,
  className = '',
  type = 'button',
  ...rest
}, ref) {
  const v = VARIANTS.has(variant) ? variant : 'default';
  const s = SIZES.has(size) ? size : 'md';
  // Join without twMerge: its utility merging would alter legacy .btn tokens such as block.
  const classes = [
    'btn',
    v,
    s !== 'md' ? s : '',
    icon ? 'icon' : '',
    block ? 'block' : '',
    className,
  ].filter(Boolean).join(' ');

  // Forward the ref so Base UI can anchor composed triggers such as Menu.
  return <BaseButton ref={ref} type={type} className={classes} {...rest} />;
});

Button.displayName = 'Button';

export default Button;
