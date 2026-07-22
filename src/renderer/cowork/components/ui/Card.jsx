// Token-driven surface containers — the one card system (ENG-791).
//
// The look lives in the `.card` classes in globals.css; this component just
// composes the class string and (optionally) the button-like a11y wiring.
// Deliberately a flexible *shell* — it does NOT impose title/body/footer
// structure, so every caller keeps its own internal layout.
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

const PADDINGS = { default: '', compact: 'compact', snug: 'snug', cozy: 'cozy', none: 'pad-none' };
const VARIANTS = { glass: 'glass', dashed: 'dashed' };

// Pure — exported so the class logic can be unit-tested directly.
export function cardClasses({
  interactive = false,
  selected = false,
  tinted = false,
  flat = false,
  variant,
  padding = 'default',
  className = '',
} = {}) {
  return [
    'card',
    interactive ? 'interactive' : '',
    selected ? 'selected' : '',
    // A tint without a selection has no meaning — ignore it.
    (selected && tinted) ? 'tinted' : '',
    flat ? 'flat' : '',
    VARIANTS[variant] || '',
    PADDINGS[padding] || '',
    className,
  ].filter(Boolean).join(' ');
}

// Pure — a11y wiring for a card that must behave like a button but can't BE one
// (a `<div>` that nests its own buttons; HTML forbids nested interactive
// content). Native `<button>` cards handle keyboard activation themselves.
export function cardActivationProps({ as, onActivate } = {}) {
  if (!onActivate) return {};
  if (as === 'button') return { onClick: onActivate };
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(e); }
    },
  };
}

export const Card = forwardRef(function Card({
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
  return (
    <As ref={ref} className={classes} {...typeProp} {...activation} {...rest}>
      {children}
    </As>
  );
});
Card.displayName = 'Card';

export const CardRow = forwardRef(function CardRow({
  as: As = 'div',
  selected = false,
  onActivate,
  className = '',
  children,
  ...rest
}, ref) {
  const classes = ['card-row', selected ? 'selected' : '', className].filter(Boolean).join(' ');
  const activation = cardActivationProps({ as: As, onActivate });
  const typeProp = As === 'button' ? { type: 'button' } : {};
  return (
    <As ref={ref} className={classes} {...typeProp} {...activation} {...rest}>
      {children}
    </As>
  );
});
CardRow.displayName = 'CardRow';

export function Bubble({ className = '', children, ...rest }) {
  const classes = ['bubble', className].filter(Boolean).join(' ');
  return <div className={classes} {...rest}>{children}</div>;
}

export default Card;
