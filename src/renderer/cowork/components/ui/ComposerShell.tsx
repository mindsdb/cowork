// The composer card shared by chat and Code Mode; styles live in globals.css
// (.composer-wrap, .composer-toolbar). Callers fill the footer slots with
// their own controls. Focus follows the textarea, so `focused` is optional.
//
//   <ComposerShell floating dragging={isDragging}>
//     …
//     <ComposerFooter start={<AddMenu />} end={<SendButton />} />
//   </ComposerShell>

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
