import { cn } from '../../lib/cn';

// A thin, read-only progress bar. First use: Settings → Usage (ENG-1782).
// Read-only by design; anything interactive is a Slider, not a Meter.
//
//   <Meter value={0.87} tone="warning" label="Free monthly tokens used" />
//
// Fill colors use the bare `accent` / `warning` / `danger` tokens, which paint
// solid; the -bg variants are pre-mixed tints meant for surfaces, not fills.
const FILL: Record<MeterTone, string> = {
  accent: 'bg-accent',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export type MeterTone = 'accent' | 'warning' | 'danger';

export interface MeterProps {
  // 0..1. Clamped; anything unparseable renders empty.
  value: number;
  tone?: MeterTone;
  // Announced to assistive tech alongside the percentage.
  label: string;
  className?: string;
}

export default function Meter({ value, tone = 'accent', label, className }: MeterProps) {
  const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const pct = Math.round(fraction * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('h-2 w-full rounded-full bg-surface-2 overflow-hidden', className)}
    >
      <div className={cn('h-full rounded-full', FILL[tone] || FILL.accent)} style={{ width: `${pct}%` }} />
    </div>
  );
}
