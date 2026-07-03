import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border font-body text-[11px] leading-none font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default:
          'border-line bg-surface-2 text-ink-2',
        accent:
          'border-accent/30 bg-accent-bg text-accent',
        success:
          'border-success/30 bg-success/10 text-success',
        danger:
          'border-danger/30 bg-danger/10 text-danger',
        muted:
          'border-transparent bg-surface-2 text-ink-3',
      },
      size: {
        sm: 'h-5 px-1.5 text-[10px]',
        md: 'h-[22px] px-2',
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
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

export { badgeVariants };
export default Badge;
