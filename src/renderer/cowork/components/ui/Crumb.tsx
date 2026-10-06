import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

// Breadcrumb primitives. `Crumb` is the clickable ancestor link, `CrumbSep`
// the "›" divider, and `CrumbCurrent` the trailing "you are here" page — same
// size/tracking as the link so the row reads as one unit.
//
// No variants, so the convention here is plain cn() + Tailwind + TS (not cva).
// Note the hover treatment is now a `hover:` utility, replacing the old
// onMouseOver/onMouseOut style-mutation handlers.

export interface CrumbProps extends ComponentPropsWithoutRef<'button'> {
  label: string;
  maxWidth?: number | string;
}

export function Crumb({ label, title, maxWidth, className, style, ...rest }: CrumbProps) {
  return (
    <button
      type="button"
      title={title || label}
      style={{ maxWidth, ...style }}
      className={cn(
        'shrink cursor-pointer appearance-none border-0 bg-transparent px-1.5 py-0.5',
        'overflow-hidden text-ellipsis whitespace-nowrap rounded-[5px]',
        'font-sans text-[13px] font-medium tracking-normal text-ink-3',
        'transition-colors duration-hover hover:bg-surface-2 hover:text-ink',
        '[-webkit-app-region:no-drag]',
        className,
      )}
      {...rest}
    >
      {label}
    </button>
  );
}

export function CrumbSep() {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 select-none px-0.5 font-sans text-[14px] leading-none text-ink-4"
    >
      ›
    </span>
  );
}

export interface CrumbCurrentProps extends ComponentPropsWithoutRef<'span'> {
  label: string;
  maxWidth?: number | string;
}

// The trailing "you are here" crumb — the current page. Same face, size and
// weight as the link (the sidebar's quiet group-heading register) so the row
// reads as one unit; it is one ink step stronger and isn't a button.
export function CrumbCurrent({ label, title, maxWidth, className, style, ...rest }: CrumbCurrentProps) {
  return (
    <span
      title={title || label}
      style={{ maxWidth, ...style }}
      className={cn(
        'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1.5 py-0.5',
        'font-sans text-[13px] font-medium tracking-normal text-ink-2',
        className,
      )}
      {...rest}
    >
      {label}
    </span>
  );
}
