// Surface styles live in globals.css; callers own the internal layout and use className for layout
// only.
// Hover uses neutral elevation; accent indicates selection.

import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementType, KeyboardEvent } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

// tinted only applies when selected.
const cardVariants = cva('card', {
  variants: {
    interactive: { true: 'interactive', false: '' },
    selected: { true: 'selected', false: '' },
    tinted: { true: '', false: '' },
    flat: { true: 'flat', false: '' },
    variant: { glass: 'glass', dashed: 'dashed' },
    padding: { default: '', compact: 'compact', snug: 'snug', cozy: 'cozy', none: 'pad-none' },
  },
  compoundVariants: [
    { selected: true, tinted: true, class: 'tinted' },
  ],
  defaultVariants: {
    interactive: false, selected: false, tinted: false, flat: false, padding: 'default',
  },
});

export interface CardVariantProps extends VariantProps<typeof cardVariants> {
  className?: string;
}

export function cardClasses({ className, ...variants }: CardVariantProps = {}): string {
  return cn(cardVariants(variants), className);
}

interface ActivationOpts {
  as?: ElementType;
  onActivate?: (e?: unknown) => void;
}

// Non-button cards need keyboard activation when nested controls prevent using a native button.
export function cardActivationProps({ as, onActivate }: ActivationOpts = {}) {
  if (!onActivate) return {};
  if (as === 'button') return { onClick: onActivate };
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(e); }
    },
  };
}

export interface CardProps
  extends CardVariantProps,
    Omit<ComponentPropsWithoutRef<'div'>, 'className'> {
  as?: ElementType;
  onActivate?: (e?: unknown) => void;
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card({
  as: As = 'div',
  interactive = false,
  selected = false,
  tinted = false,
  flat = false,
  variant,
  padding = 'default',
  onActivate,
  className = '',
  children,
  ...rest
}, ref) {
  const classes = cardClasses({ interactive, selected, tinted, flat, variant, padding, className });
  const activation = cardActivationProps({ as: As, onActivate });
  const typeProp = As === 'button' ? { type: 'button' } : {};
  // Dynamic tags require a shared ref/props escape hatch.
  const Comp: any = As;
  return (
    <Comp ref={ref} className={classes} {...typeProp} {...activation} {...rest}>
      {children}
    </Comp>
  );
});
Card.displayName = 'Card';

export interface CardRowProps extends Omit<ComponentPropsWithoutRef<'div'>, 'className'> {
  as?: ElementType;
  selected?: boolean;
  onActivate?: (e?: unknown) => void;
  className?: string;
}

export const CardRow = forwardRef<HTMLElement, CardRowProps>(function CardRow({
  as: As = 'div',
  selected = false,
  onActivate,
  className = '',
  children,
  ...rest
}, ref) {
  const classes = cn('card-row', selected && 'selected', className);
  const activation = cardActivationProps({ as: As, onActivate });
  const typeProp = As === 'button' ? { type: 'button' } : {};
  const Comp: any = As;
  return (
    <Comp ref={ref} className={classes} {...typeProp} {...activation} {...rest}>
      {children}
    </Comp>
  );
});
CardRow.displayName = 'CardRow';

export type BubbleProps = ComponentPropsWithoutRef<'div'>;

export function Bubble({ className = '', children, ...rest }: BubbleProps) {
  return <div className={cn('bubble', className)} {...rest}>{children}</div>;
}

export default Card;
