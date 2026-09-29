// The one composer surface, shared by chat (Home, Projects, a chat task) and
// Code Mode (new task, task follow-ups).
//
// The look lives in the `.composer-wrap` / `.composer-toolbar` classes in
// globals.css. The shell owns the card: border, surface, radius, shadow,
// focus and drop-target states. Callers own what goes inside it — the input,
// chips, menus — and fill the footer's slots with their own controls, so each
// context swaps its buttons without restyling the card.
//
//   <ComposerShell>…</ComposerShell>            // resting on the page (Home, new task)
//   <ComposerShell floating>…</ComposerShell>   // floating over a transcript
//   <ComposerShell dragging={isDragging}>       // files dragged over it
//   <ComposerFooter
//     start={<AddMenu />}                        // context actions, left
//     end={<><ModelPicker /><SendButton /></>}   // pickers and send, right
//   />
//
// Focus needs no wiring: the card takes its focus state whenever its textarea
// is focused. `focused` remains for callers that already track focus.

import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const composerShellVariants = cva('composer-wrap', {
  variants: {
    floating: { true: 'composer-wrap--floating', false: '' },
    focused: { true: 'focused', false: '' },
    dragging: { true: 'is-dragging-files', false: '' },
  },
  defaultVariants: { floating: false, focused: false, dragging: false },
});

export interface ComposerShellVariantProps extends VariantProps<typeof composerShellVariants> {
  className?: string;
}

// Pure — exported so the class logic can be unit-tested directly.
export function composerShellClasses({ className, ...variants }: ComposerShellVariantProps = {}): string {
  return cn(composerShellVariants(variants), className);
}

export interface ComposerShellProps
  extends ComposerShellVariantProps,
    Omit<ComponentPropsWithoutRef<'div'>, 'className'> {}

export const ComposerShell = forwardRef<HTMLDivElement, ComposerShellProps>(function ComposerShell({
  floating,
  focused,
  dragging,
  className,
  children,
  ...rest
}, ref) {
  return (
    <div ref={ref} className={composerShellClasses({ floating, focused, dragging, className })} {...rest}>
      {children}
    </div>
  );
});
ComposerShell.displayName = 'ComposerShell';

export interface ComposerFooterProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  start?: ReactNode;
  end?: ReactNode;
}

export function ComposerFooter({ start, end, className, ...rest }: ComposerFooterProps) {
  return (
    <div className={cn('composer-toolbar', className)} {...rest}>
      {start}
      <span className="composer-toolbar__spacer" aria-hidden="true" />
      {end}
    </div>
  );
}

export default ComposerShell;
