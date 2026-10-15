import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

// Inline message block — a persistent callout for form/page errors, warnings,
// and info notices. Distinct from `Toast` (transient, floating) and `Badge`
// (compact status label). This consolidates the ~15 hand-rolled
// `color-mix(var(--danger)…)` boxes scattered across the app (ENG-1146).
//
//   <Alert variant="danger">Couldn't save — try again.</Alert>
//   <Alert variant="warning" title="Heads up" icon={<Ico.warn />}>…</Alert>
//   <Alert variant="danger" title="Paused" actions={<Button size="sm">Resume</Button>}>…</Alert>
//
// Structure: icon | title, body, actions. Actions sit under the body, lined
// up with the text rather than the icon, so a long body never squeezes the
// buttons and the buttons never squeeze the body. Put the main action first.
//
// Uses the dedicated -bg/-border/-text tokens (theme-aware, pre-mixed) rather
// than Tailwind's opacity modifier — see the long note in Badge.tsx for why
// `bg-danger/10` silently emits no CSS against a `var(--…)` color.
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
  // Leading icon slot (kept icon-agnostic, like Badge — caller supplies it).
  icon?: ReactNode;
  // Optional bold heading rendered above the body.
  title?: ReactNode;
  // Buttons that act on what the alert says, laid out under the body.
  actions?: ReactNode;
}

export function Alert({ className, variant, icon, title, actions, role, children, ...props }: AlertProps) {
  // Errors/warnings announce themselves to assistive tech; info/success are
  // passive. Callers can still override via an explicit `role`.
  const resolvedRole = role ?? (variant === 'danger' || variant === 'warning' ? 'alert' : undefined);
  return (
    <div className={cn(alertVariants({ variant }), className)} role={resolvedRole} {...props}>
      {icon && <span className="inline-flex shrink-0 mt-px">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children}
        {actions && <div className="mt-2.5 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export { alertVariants };
export default Alert;
