// Eyebrow — small uppercase mono label that sits above headings or
// as a section delimiter, per the design guideline.
//
//   <Eyebrow>Models</Eyebrow>
//   <Eyebrow as="h3">Settings</Eyebrow>

import type { ComponentPropsWithoutRef, ElementType } from 'react';
import { cn } from '../../lib/cn';

export interface EyebrowProps extends ComponentPropsWithoutRef<'span'> {
  as?: ElementType;
}

export default function Eyebrow({ as: Tag = 'span', className, children, ...rest }: EyebrowProps) {
  // Polymorphic tag — `any` sidesteps polymorphic-props friction; runtime unchanged.
  const Comp: any = Tag;
  return <Comp className={cn('eyebrow', className)} {...rest}>{children}</Comp>;
}
