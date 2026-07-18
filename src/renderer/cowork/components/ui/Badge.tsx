import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

// The one small-rounded-label primitive for the whole app — status badges,
// count badges, category tags, "coming soon" markers. Consolidates what used
// to be Badge + Pill + ArtifactStatus's own unrelated local `Pill` +
// channels-badge + dispatch-button-badge + mshell-row__badge + customize-chip,
// each a slightly different one-off. One shape (pill), one set of variants,
// sizes cover every dimension those call sites actually needed.
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-body leading-none font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default:
          'border-line bg-surface-2 text-ink-2',
        accent:
          'border-accent/30 bg-accent-bg text-accent',
        success:
          'border-success/30 bg-success/10 text-success',
        warning:
          'border-warning/30 bg-warning-bg text-warning',
        danger:
          'border-danger/30 bg-danger/10 text-danger',
        muted:
          'border-transparent bg-surface-2 text-ink-3',
        // For a badge sitting on a solid/tinted colored surface (e.g. inside
        // an accent-filled button) rather than the app's neutral surface —
        // none of the token-driven variants above read correctly there.
        inverse:
          'border-white/20 bg-white/16 text-white/86',
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
  // Leading colored dot (currentColor, so it always matches the variant).
  dot?: boolean;
  // Leading icon slot, rendered before the label.
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
