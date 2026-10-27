// Quiet status for item meta: a 6px dot + a short label. Colour carries the
// state; the label stays ink-3 except for states that need attention.
//
//   <StatusDot tone="success">Connected</StatusDot>
//   <StatusDot tone="danger">Last run failed</StatusDot>

import type { ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export type StatusTone = 'success' | 'warning' | 'danger' | 'accent' | 'muted';

const label = cva('inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs', {
  variants: {
    tone: { success: 'text-ink-3', warning: 'text-warning', danger: 'text-danger', accent: 'text-ink-3', muted: 'text-ink-3' },
  },
  defaultVariants: { tone: 'muted' },
});

// `--success` (not the static `success` colour) follows the theme.
const dot = cva('h-1.5 w-1.5 shrink-0 rounded-full', {
  variants: {
    tone: { success: 'bg-[var(--success)]', warning: 'bg-warning', danger: 'bg-danger', accent: 'bg-accent', muted: 'bg-ink-4' },
  },
  defaultVariants: { tone: 'muted' },
});

export interface StatusDotProps {
  tone?: StatusTone;
  children?: ReactNode;
  className?: string;
}

export function StatusDot({ tone = 'muted', children, className }: StatusDotProps) {
  return (
    <span className={cn(label({ tone }), className)}>
      <span aria-hidden="true" className={dot({ tone })} />
      {children}
    </span>
  );
}

export default StatusDot;
