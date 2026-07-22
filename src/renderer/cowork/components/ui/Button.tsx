// Token-driven button. Wraps Base UI's <Button> for native button semantics,
// focus-visible handling, and `render`-based composition (polymorphic links) —
// styled with the existing `.btn` class system so the rendered markup and look
// are unchanged. Base UI is unstyled; the pixels come entirely from `.btn`.
//
// Examples:
//   <Button>Save draft</Button>                          // default neutral
//   <Button variant="primary">Continue</Button>          // accent + glow
//   <Button variant="subtle">Cancel</Button>             // borderless
//   <Button variant="tinted">Compose</Button>            // faint accent wash
//   <Button variant="solid">Publish</Button>             // filled page CTA
//   <Button variant="danger" size="sm">Delete</Button>
//   <Button icon size="sm" aria-label="Search">{icon}</Button>
//   <Button block>Sign in</Button>
//   <Button render={<a href="/docs" />}>Docs</Button>    // render as an <a>

import { forwardRef } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentPropsWithoutRef, ComponentRef } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'subtle' | 'tinted' | 'solid' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// Extend Base UI's Button props (which include `render`, native button attrs,
// and `focusableWhenDisabled`) but take `className` as a plain string — we build
// the legacy class string ourselves and must not let a Tailwind-aware merge
// touch it (`block` is also a Tailwind utility).
export interface ButtonProps
  extends Omit<ComponentPropsWithoutRef<typeof BaseButton>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  block?: boolean;
  className?: string;
}

const VARIANTS = new Set<ButtonVariant>(['default', 'primary', 'subtle', 'tinted', 'solid', 'danger']);
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
  // Byte-identical to the previous Button.jsx class string. Plain join — NOT
  // twMerge — so the legacy `.btn` modifier tokens pass through untouched.
  const classes = [
    'btn',
    v !== 'default' ? v : '',
    s !== 'md' ? s : '',
    icon ? 'icon' : '',
    block ? 'block' : '',
    className,
  ].filter(Boolean).join(' ');

  // Forward the ref so Base UI can compose onto us: <Menu trigger={<Button/>}>
  // merges the trigger's props AND ref onto this element to anchor the popup,
  // and polymorphic `render` (passed via ...rest) keeps working.
  return <BaseButton ref={ref} type={type} className={classes} {...rest} />;
});

Button.displayName = 'Button';

export default Button;
