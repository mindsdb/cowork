import type { CSSProperties } from 'react';
import { cn } from '../../lib/cn';

// Breadcrumb primitives. `Crumb` is the clickable ancestor link, `CrumbSep`
// the "›" divider, and `CrumbCurrent` the trailing "you are here" page — same
// size/tracking as the link so the row reads as one unit.
//
// No variants, so the convention here is plain cn() + Tailwind + TS (not cva).
// Note the hover treatment is now a `hover:` utility, replacing the old
// onMouseOver/onMouseOut style-mutation handlers.

export interface CrumbProps {
  label: string;
  onClick?: () => void;
  title?: string;
  maxWidth?: number | string;
}

export function Crumb({ label, onClick, title, maxWidth }: CrumbProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      style={{ maxWidth }}
      className={cn(
        'shrink cursor-pointer appearance-none border-0 bg-transparent px-1.5 py-0.5',
        'overflow-hidden text-ellipsis whitespace-nowrap rounded-[5px]',
        'font-display text-[13px] font-semibold tracking-normal text-ink-3',
        'transition-colors duration-[120ms] hover:bg-surface-2 hover:text-ink',
        '[-webkit-app-region:no-drag]',
      )}
    >
      {label}
    </button>
  );
}

export function CrumbSep() {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 select-none px-0.5 font-display text-[14px] leading-none text-ink-4"
    >
      ›
    </span>
  );
}

export interface CrumbCurrentProps {
  label: string;
  title?: string;
  maxWidth?: number | string;
  style?: CSSProperties;
}

// The trailing "you are here" crumb — the current page. Same size (13) and
// tracking (0) as the link so the row reads as one unit; the only differences
// are colour (ink, not ink-3) and that it isn't a button.
export function CrumbCurrent({ label, title, maxWidth, style }: CrumbCurrentProps) {
  return (
    <span
      title={title || label}
      style={{ maxWidth, ...style }}
      className={cn(
        'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1.5 py-0.5',
        'font-display text-[13px] font-semibold tracking-normal text-ink',
      )}
    >
      {label}
    </span>
  );
}
