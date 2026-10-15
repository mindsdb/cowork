import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

// Inline message block — a persistent callout for form/page errors, warnings,
// and info notices. Distinct from `Toast` (transient, floating) and `Badge`
// (compact status label). This consolidates the ~15 hand-rolled
// `color-mix(var(--danger)…)` boxes scattered across the app (ENG-1146).
//
//   <Alert variant="danger">Couldn't save — try again.</Alert>
//   <Alert variant="warning" title="Heads up">…</Alert>
//   <Alert variant="danger" title="Paused" actions={<Button size="sm">Resume</Button>}>…</Alert>
//
// Structure: icon | title, body, actions. Actions sit under the body, lined
// up with the text rather than the icon, so a long body never squeezes the
// buttons and the buttons never squeeze the body. Put the main action first.
//
// Uses the dedicated -bg/-border tokens (theme-aware, pre-mixed) rather than
// Tailwind's opacity modifier — see the long note in Badge.tsx for why
// `bg-danger/10` silently emits no CSS against a `var(--…)` color.
//
// Tone lives in the surface and the icon; the text stays neutral so the title
// can lead. The title reads in ink, the body in ink-2, and a caller's quieter
// note can use ink-3. Buttons in `actions` are small and quiet (a default
// button, then a subtle one): an alert points at the next step, it isn't the
// page's main call to action.
const alertVariants = cva(
  'flex gap-2.5 rounded-card-row border border-solid p-3 font-body text-sm leading-relaxed text-ink-2',
  {
    variants: {
      variant: {
        info: 'bg-info-bg border-info-border',
        success: 'bg-success-bg border-success-border',
        warning: 'bg-warning-bg border-warning-border',
        danger: 'bg-danger-bg border-danger-border',
      },
    },
    defaultVariants: { variant: 'info' },
  }
);

// Each variant's glyph and its colour: the one strongly coloured element.
const VARIANT_ICON = {
  info: { glyph: Info, tone: 'text-accent' },
  success: { glyph: CircleCheck, tone: 'text-[var(--success)]' },
  warning: { glyph: TriangleAlert, tone: 'text-warning' },
  danger: { glyph: CircleAlert, tone: 'text-danger' },
} as const;

export interface AlertProps
  // Omit native `title` (a string attr) so our `title` slot can take a ReactNode.
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  // Leading icon. Defaults to the variant's glyph; pass a node to replace it,
  // or null for none.
  icon?: ReactNode;
  // Optional heading rendered above the body.
  title?: ReactNode;
  // Buttons that act on what the alert says, laid out under the body.
  actions?: ReactNode;
}

export function Alert({ className, variant, icon, title, actions, role, children, ...props }: AlertProps) {
  // Errors/warnings announce themselves to assistive tech; info/success are
  // passive. Callers can still override via an explicit `role`.
  const resolvedRole = role ?? (variant === 'danger' || variant === 'warning' ? 'alert' : undefined);
  const look = VARIANT_ICON[variant ?? 'info'];
  const lead = icon === undefined ? <Icon of={look.glyph} size={16} aria-hidden="true" /> : icon;
  return (
    <div className={cn(alertVariants({ variant }), className)} role={resolvedRole} {...props}>
      {/* As tall as the first line, so the icon centres on it. */}
      {lead != null && lead !== false && (
        <span className={cn('inline-flex h-[1.625em] shrink-0 items-center', look.tone)}>{lead}</span>
      )}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold text-ink">{title}</div>}
        {children}
        {actions && <div className="mt-2.5 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export { alertVariants };
export default Alert;
