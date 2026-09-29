// The composer card shared by chat and Code Mode; styles live in globals.css.
// Focus follows the textarea, so `focused` is only for callers that track it.
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

type ComposerShellProps = ComponentPropsWithoutRef<'div'> & { floating?: boolean; focused?: boolean; dragging?: boolean };

export function ComposerShell({ floating, focused, dragging, className, ...rest }: ComposerShellProps) {
  return <div className={cn('composer-wrap', floating && 'composer-wrap--floating', focused && 'focused', dragging && 'is-dragging-files', className)} {...rest} />;
}

// Each context brings its own controls; a ComposerSpacer pushes the rest to the end.
export function ComposerFooter({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('composer-toolbar', className)} {...rest} />;
}

export function ComposerSpacer() {
  return <span className="composer-toolbar__spacer" aria-hidden="true" />;
}

export default ComposerShell;
