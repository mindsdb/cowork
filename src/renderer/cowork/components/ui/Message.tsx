// Message — themed callout box with variants.
//
//   <Message>Something went wrong.</Message>
//   <Message variant="warning">Check your input.</Message>
//   <Message variant="info">Tip: you can also drag and drop.</Message>
//   <Message variant="success">Connected successfully.</Message>

import type { ComponentPropsWithoutRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const messageVariants = cva(
  'rounded-[10px] px-3 py-2.5 font-body text-[13.5px] leading-normal select-text border border-solid',
  {
    variants: {
      variant: {
        error:   'border-danger-border bg-danger-bg text-danger-text',
        warning: 'border-warning-border bg-warning-bg text-warning-text',
        info:    'border-info-border bg-info-bg text-info-text',
        success: 'border-success-border bg-success-bg text-success-text',
      },
    },
    defaultVariants: { variant: 'error' },
  },
);

export interface MessageProps
  extends ComponentPropsWithoutRef<'div'>,
    VariantProps<typeof messageVariants> {}

export default function Message({ variant, className, children, ...rest }: MessageProps) {
  return (
    <div className={cn(messageVariants({ variant }), className)} {...rest}>
      {children}
    </div>
  );
}
