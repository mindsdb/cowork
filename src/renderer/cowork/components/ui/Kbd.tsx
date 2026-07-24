// Keyboard-shortcut chip. Styling lives in the `.kbd` class (globals.css).
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

export function Kbd({ className, children, ...rest }: ComponentPropsWithoutRef<'kbd'>) {
  return <kbd className={cn('kbd', className)} {...rest}>{children}</kbd>;
}

export default Kbd;
