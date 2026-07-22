// Token-driven button. Wraps Base UI's <Button> for native button semantics,
// focus-visible handling, and `render`-based composition (polymorphic links) —
// painted by the `.btn` class system in globals.css (Base UI ships unstyled).
//
// API contract — what owns what:
//   • `variant` selects the COMPLETE visual treatment (tone + emphasis) and is
//     the ONLY prop that picks a style. Every treatment is a named variant, so
//     call sites never encode one via `className`.
//   • `size` / `icon` / `block` are structural modifiers.
//   • `className` is a LAYOUT-ONLY escape hatch (margin, alignSelf, flex, width).
//     Never use it to select a style treatment, and keep in mind it must not be
//     a Tailwind class a merge could touch (`block` collides) — hence the plain
//     join below, not twMerge.
//
// Variants:
//   default       neutral, quiet          (surface + hairline border)
//   primary       accent, prominent       (filled accent — the main CTA)
//   tinted        accent, quiet           (faint accent wash)
//   subtle        ghost                   (borderless until hover)
//   danger        destructive, quiet      (red label; reddens on hover)
//   danger-solid  destructive, prominent  (solid red — the confirm step)
//
// Examples:
//   <Button variant="primary">Save changes</Button>
//   <Button variant="subtle">Cancel</Button>
//   <Button variant="danger" size="sm">Delete</Button>
//   <Button variant="danger-solid">Delete permanently</Button>
//   <Button icon aria-label="Search">{icon}</Button>
//   <Button block style={{ alignSelf: 'flex-start' }}>Sign in</Button>
//   <Button render={<a href="/docs" />}>Docs</Button>    // render as an <a>

import { forwardRef } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentPropsWithoutRef, ComponentRef } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'subtle' | 'tinted' | 'danger' | 'danger-solid';
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
  // Plain join — NOT twMerge — so the legacy `.btn` modifier tokens pass
  // through untouched. The variant token is always emitted (including
  // `default`) so `.btn.default` can carry the neutral styling without
  // leaking onto the colored variants; `md` is still the implicit size.
  const classes = [
    'btn',
    v,
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
