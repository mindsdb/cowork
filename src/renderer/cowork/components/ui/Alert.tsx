import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

// Uses pre-mixed color tokens; Tailwind opacity modifiers do not resolve these CSS variable colors.
const alertVariants = cva(
  'flex gap-2.5 rounded-card-row border p-3 font-body text-sm leading-relaxed',
  {
    variants: {
      variant: {
        info: 'bg-info-bg border-info-border text-info-text',
        success: 'bg-success-bg border-success-border text-success-text',
        warning: 'bg-warning-bg border-warning-border text-warning-text',
        danger: 'bg-danger-bg border-danger-border text-danger-text',
      },
    },
    defaultVariants: { variant: 'info' },
  }
);

export interface AlertProps
  // Omit native `title` (a string attr) so our `title` slot can take a ReactNode.
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  icon?: ReactNode;
  title?: ReactNode;
}

export function Alert({ className, variant, icon, title, role, children, ...props }: AlertProps) {
  // Errors and warnings announce immediately; info and success remain passive unless role is
  // overridden.
  const resolvedRole = role ?? (variant === 'danger' || variant === 'warning' ? 'alert' : undefined);
  return (
    <div className={cn(alertVariants({ variant }), className)} role={resolvedRole} {...props}>
      {icon && <span className="inline-flex shrink-0 mt-px">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export { alertVariants };
export default Alert;
