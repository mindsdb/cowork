import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';


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
        'font-display text-[13px] font-semibold tracking-normal text-ink-3',
        'transition-colors duration-[120ms] hover:bg-surface-2 hover:text-ink',
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
      className="shrink-0 select-none px-0.5 font-display text-[14px] leading-none text-ink-4"
    >
      ›
    </span>
  );
}

export interface CrumbCurrentProps extends ComponentPropsWithoutRef<'span'> {
  label: string;
  maxWidth?: number | string;
}

export function CrumbCurrent({ label, title, maxWidth, className, style, ...rest }: CrumbCurrentProps) {
  return (
    <span
      title={title || label}
      style={{ maxWidth, ...style }}
      className={cn(
        'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1.5 py-0.5',
        'font-display text-[13px] font-semibold tracking-normal text-ink',
        className,
      )}
      {...rest}
    >
      {label}
    </span>
  );
}
