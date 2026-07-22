import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

// Shared small-rounded-label primitive for status badges, count badges,
// category tags, and "coming soon" markers. This consolidates the migrated
// Badge/Pill/channel/artifact call sites onto one shape and variant palette;
// specialized interactive pills and remaining feature-local annotations stay
// outside this primitive until they can be migrated without changing behavior.
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-body leading-none font-medium whitespace-nowrap',
  {
    // Note: these deliberately use the config's dedicated -bg/-border
    // tokens (e.g. `bg-danger-bg`, `border-danger-border`) rather than
    // Tailwind's opacity modifier (`bg-danger/10`). The modifier only
    // resolves when the color is a literal value Tailwind can see at
    // build time — accent/warning/danger are `var(--x)` references in
    // tailwind.config.js, so `bg-danger/10`/`border-danger/30` silently
    // produce no CSS rule at all (only the unmodified `text-danger`
    // works). The -bg/-border tokens are already pre-mixed for exactly
    // this and stay theme-aware, unlike opacity-modifying a color that'd
    // have to be a frozen literal hex to support the modifier at all.
    variants: {
      variant: {
        default:
          'border-line bg-surface-2 text-ink-2',
        // No accent-border token exists (unlike success/warning/danger),
        // and accent-3 is a different, darker color, not a tint of accent
        // — so this one keeps the 30%-opacity intent via an arbitrary
        // color-mix() value instead, which (unlike the opacity modifier)
        // works with a var() reference since it's inserted as literal CSS.
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
        // For a badge sitting on a solid/tinted colored surface (e.g. inside
        // an accent-filled button) rather than the app's neutral surface —
        // none of the token-driven variants above read correctly there.
        // Literal arbitrary values, not opacity modifiers: `white` is one
        // of Tailwind's own colors, but empirically `bg-white/16` still
        // silently produced no rule here (`border-white/20` did work,
        // inconsistently) — arbitrary values sidestep the question
        // entirely since they're inserted as raw CSS.
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
