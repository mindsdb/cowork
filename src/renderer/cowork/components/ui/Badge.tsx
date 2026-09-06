import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-body leading-none font-medium whitespace-nowrap',
  {
    // Use pre-mixed -bg/-border tokens: Tailwind opacity modifiers emit no CSS for these var()
    // colors.
    variants: {
      variant: {
        default:
          'border-line bg-surface-2 text-ink-2',
        // There is no accent-border token; accent-3 is darker, so mix an accent tint explicitly.
        accent:
          'border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-accent-bg text-accent',
        success:
          'border-success-border bg-success-bg text-success-text',
        warning:
          'border-warning-border bg-warning-bg text-warning',
        danger:
          'border-danger-border bg-danger-bg text-danger',
        muted:
          'border-transparent bg-surface-2 text-ink-3',
        // For colored surfaces. Explicit rgba values avoid missing Tailwind opacity utilities.
        inverse:
          'border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.16)] text-[rgba(255,255,255,0.86)]',
      },
      size: {
        xs: 'h-[18px] px-1.5 text-[10px]',
        sm: 'h-5 px-1.5 text-[10px]',
        md: 'h-[22px] px-2 text-[11px]',
        lg: 'h-6 px-2.5 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
  icon?: ReactNode;
}

export function Badge({ className, variant, size, dot, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && <span className="w-[5px] h-[5px] rounded-full bg-current shrink-0" />}
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      {children}
    </span>
  );
}

export { badgeVariants };
export default Badge;
