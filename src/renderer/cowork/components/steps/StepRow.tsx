// One step row, shared by Cowork's ThinkingBlock and Code Mode's activity
// groups. It only draws: each surface's adapter turns its own data into
// these props (thinking/ThinkingStep.jsx, code/EventTimeline.tsx).
//
// Anatomy, in order: glyph · verb + target · duration · status · tag ·
// extra · chevron. A row that opens something is a button: it toggles its
// own detail when given `detail`, or calls `onActivate` (Cowork opens the
// object or the scratchpad). A row with neither is plain text and has no
// hover state.
//
// The variant is layout only. `timeline` puts the glyph on a vertical rail
// at 12.5px, inside Cowork's "Worked for" block. `list` is Code Mode's
// railless 14px list.

import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { StepGlyph } from './stepIcons';
import { STEP_STATUS_TEXT, type StepStatus } from './stepStatus';

export type StepRowVariant = 'timeline' | 'list';

export interface StepRowProps {
  icon?: string;
  verb?: string;
  target: string;
  status?: StepStatus;
  /** Replaces the default status word or tooltip, e.g. "Timed out". */
  statusLabel?: string;
  statusTitle?: string;
  duration?: string | null;
  /** The kind of object the row made, e.g. "artifact". */
  tag?: string;
  extra?: ReactNode;
  variant?: StepRowVariant;
  /** Timeline only: the rail stops at the first and last rows. */
  first?: boolean;
  last?: boolean;
  onActivate?: () => void;
  detail?: () => ReactNode;
  className?: string;
}

const DOT_FRAMES = ['.', '..', '...', '..', '.'];

function TextDots() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % DOT_FRAMES.length), 400);
    return () => clearInterval(id);
  }, []);
  // Match the label's 12.5px. Without an explicit size the dots inherit the
  // 16px body size, and a running row is ~5px taller than a settled one.
  return <span className="inline-block w-5 text-ink-4 text-[12.5px] leading-[1.5]">{DOT_FRAMES[idx]}</span>;
}

export function StepRow({
  icon,
  verb = '',
  target,
  status = 'done',
  statusLabel,
  statusTitle,
  duration,
  tag,
  extra,
  variant = 'list',
  first = false,
  last = false,
  onActivate,
  detail,
  className,
}: StepRowProps) {
  const [open, setOpen] = useState(false);
  const timeline = variant === 'timeline';
  const running = status === 'running';
  const failed = status === 'failed';
  const interactive = Boolean(detail || onActivate);
  const label = [verb, target].filter(Boolean).join(' ');

  const glyph = (
    <span
      aria-hidden="true"
      className={clsx('step-row__icon inline-flex flex-none', failed ? 'text-danger' : !timeline && 'text-ink-4')}
    >
      <StepGlyph name={icon} size={timeline ? 12 : 14} />
    </span>
  );

  const text = (
    <span
      className={clsx(
        'step-row__label min-w-0 truncate',
        timeline && 'text-[12.5px]',
        timeline && (running ? 'text-ink' : 'text-ink-3'),
      )}
      title={timeline ? label : undefined}
    >
      {verb && <span className={clsx('step-row__verb', failed && 'text-danger')}>{verb}</span>}
      {verb && target ? ' ' : ''}
      <span className={clsx('step-row__target', !timeline && 'text-ink-3')}>{target}</span>
    </span>
  );

  const meta = (
    <>
      {duration && !running && <span className="w-10 text-right text-[11px] text-ink-4">{duration}</span>}
      {failed && (
        <span
          className={clsx('step-row__status flex-none text-danger', timeline ? 'text-[11px]' : 'text-[12.5px]')}
          title={statusTitle}
        >
          {statusLabel || STEP_STATUS_TEXT.failed}
        </span>
      )}
      {status === 'recovered' && (
        <span
          role="img"
          aria-label={statusLabel || STEP_STATUS_TEXT.recovered}
          className="step-row__status h-1.5 w-1.5 flex-none rounded-full bg-warning"
          style={{ animation: 'step-error-dot-fade 4s ease-out forwards' }}
          title={statusTitle || statusLabel || STEP_STATUS_TEXT.recovered}
        />
      )}
      {tag && (
        <span className="rounded-md border border-line bg-surface-2 px-1.5 py-px text-[10px] uppercase tracking-wider text-ink-4">
          {tag}
        </span>
      )}
      {extra}
      {detail && (
        <span
          aria-hidden="true"
          className={clsx(
            'inline-flex flex-none text-ink-4 transition-transform duration-hover',
            open ? 'rotate-180 opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {Ico.chevDown(12)}
        </span>
      )}
    </>
  );

  const body = timeline ? (
    <>
      <span className="flex w-4 flex-none flex-col items-center">
        <span className={clsx('block w-px flex-1', first ? 'bg-transparent' : 'bg-line-2')} />
        <span
          className={clsx(
            'my-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full',
            running ? 'bg-surface-2' : 'bg-surface-2/60',
          )}
        >
          {glyph}
        </span>
        <span className={clsx('block w-px flex-1', last ? 'bg-transparent' : 'bg-line-2')} />
      </span>
      <span
        className={clsx(
          'flex min-w-0 flex-1 items-center justify-between rounded-md py-1.5',
          interactive && 'transition-colors duration-hover group-hover:bg-surface-2/60',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5 px-1">
          {text}
          {running && <TextDots />}
        </span>
        <span className="ml-2 flex flex-none items-center gap-2 pr-1">{meta}</span>
      </span>
    </>
  ) : (
    <>
      {glyph}
      {text}
      {meta}
    </>
  );

  const headClass = clsx(
    'step-row__head group flex w-full min-w-0 text-left',
    timeline ? 'gap-1.5' : 'items-center gap-[7px] py-[3px] text-[14px] leading-[1.45] text-ink-4',
    interactive && 'cursor-pointer rounded-md border-0 bg-transparent px-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    interactive && timeline && 'py-0 text-inherit [font:inherit]',
    interactive && !timeline && '[font-family:var(--font-sans)] hover:text-ink-3',
  );

  const head = detail ? (
    <button type="button" className={headClass} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      {body}
    </button>
  ) : onActivate ? (
    <button type="button" className={headClass} onClick={onActivate}>
      {body}
    </button>
  ) : (
    <div className={headClass}>{body}</div>
  );

  return (
    <div
      className={clsx('step-row min-w-0', failed && 'is-failed', open && 'is-open', className)}
      data-status={status}
    >
      {head}
      {open && detail?.()}
    </div>
  );
}
