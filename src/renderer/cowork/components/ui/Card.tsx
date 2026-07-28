// Token-driven surface containers — the one card system (ENG-791).
//
// The look lives in the `.card` classes in globals.css; this component just
// assembles the modifier tokens (via cva) and merges a layout-only className
// (via cn). Deliberately a flexible *shell* — it does NOT impose
// title/body/footer structure, so every caller keeps its own internal layout.
// (ENG-1018: retrofitted onto the cva + cn + TS authoring convention.)
//
//   <Card>…</Card>                              // static panel, 24px pad, --sh-1
//   <Card padding="compact">…</Card>            // 16px  ('snug'=12, 'cozy'=14/16)
//   <Card flat>…</Card>                         // no resting shadow
//   <Card interactive onActivate={open}>…</Card>// canonical hover/active/focus
//   <Card as="button" interactive onClick={…}/> // native button (no nested btns)
//   <Card selected tinted>…</Card>              // accent border (+ --accent-bg)
//   <Card variant="glass" flat>…</Card>         // backdrop-blur panel
//   <Card variant="dashed" interactive>…</Card> // empty-state / dropzone
//   <CardRow onActivate={open}>…</CardRow>      // flat interactive list row
//   <Bubble>…</Bubble>                          // glassy floating surface
//
// The single hover/active animation is ELEVATION ONLY (lift + soft shadow,
// neutral border). Accent is reserved for the selected state, never hover.

import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementType, KeyboardEvent } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

// cva assembles the legacy `.card` modifier tokens. `tinted` is only
// meaningful alongside `selected`, so it carries no class of its own — the
// compound variant emits `tinted` only when both are set.
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

// Pure — exported so the class logic can be unit-tested directly.
export function cardClasses({ className, ...variants }: CardVariantProps = {}): string {
  return cn(cardVariants(variants), className);
}

interface ActivationOpts {
  as?: ElementType;
  onActivate?: (e?: unknown) => void;
}

// Pure — a11y wiring for a card that must behave like a button but can't BE one
// (a `<div>` that nests its own buttons; HTML forbids nested interactive
// content). Native `<button>` cards handle keyboard activation themselves.
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
  // Polymorphic element — `any` sidesteps the well-known ref-typing friction
  // of a dynamic component; runtime behaviour is unchanged.
  // Polymorphic tag — typed `any` to sidestep the well-known polymorphic
  // ref/props friction; runtime behaviour is unchanged.
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
  // Polymorphic tag — typed `any` to sidestep the well-known polymorphic
  // ref/props friction; runtime behaviour is unchanged.
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
