import type { ComponentPropsWithoutRef, ElementType } from 'react';
import { cn } from '../../lib/cn';

export interface EyebrowProps extends ComponentPropsWithoutRef<'span'> {
  as?: ElementType;
}

export default function Eyebrow({ as: Tag = 'span', className, children, ...rest }: EyebrowProps) {
  const Comp: any = Tag;
  return <Comp className={cn('eyebrow', className)} {...rest}>{children}</Comp>;
}
