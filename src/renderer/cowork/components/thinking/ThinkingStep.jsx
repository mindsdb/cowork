// One row inside the expanded ThinkingBlock. Vertical-line "rail" on
// the left, icon, label, optional duration on the right.
//
// Adapted from mdb-ai's ThinkingStep.jsx — without jotai. We don't need
// the side-panel scratchpad navigation here either; click handling is
// delegated via onActivate, which the parent can wire up when ready.

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { StepIcon } from './StepIcon';

const DOT_FRAMES = ['.', '..', '...', '..', '.'];
function TextDots() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % DOT_FRAMES.length), 400);
    return () => clearInterval(id);
  }, []);
  return <span className="inline-block w-5 text-ink-4">{DOT_FRAMES[idx]}</span>;
}

function formatStepDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const seconds = Math.floor((completedAt - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function ThinkingStep({
  step,
  isFirst = false,
  isLast = false,
  onActivate,
}) {
  const isInProgress = step.status === 'in_progress';
  const duration = formatStepDuration(step.startedAt, step.completedAt);

  return (
    <div
      className={clsx(
        'group flex gap-1.5',
        onActivate && 'cursor-pointer'
      )}
      onClick={onActivate ? () => onActivate(step) : undefined}
    >
      {/* Left rail — vertical line + circular marker. */}
      <div className="flex w-4 flex-col items-center">
        <div className={clsx('w-px flex-1', isFirst ? 'bg-transparent' : 'bg-line-2')} />
        <div
          className={clsx(
            'my-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full',
            isInProgress ? 'bg-surface-2' : 'bg-surface-2/60'
          )}
        >
          <StepIcon type={step.icon} size={12} />
        </div>
        <div className={clsx('w-px flex-1', isLast ? 'bg-transparent' : 'bg-line-2')} />
      </div>

      {/* Right column — label + meta */}
      <div
        className={clsx(
          'flex min-w-0 flex-1 items-center justify-between rounded-md py-1.5',
          'transition-colors duration-150 group-hover:bg-surface-2/60'
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5 px-1">
          <span
            className={clsx(
              'truncate text-[12.5px]',
              isInProgress ? 'text-ink' : 'text-ink-3'
            )}
            title={step.label}
          >
            {step.label}
          </span>
          {isInProgress && <TextDots />}
        </div>
        <div className="ml-2 flex flex-none items-center gap-2 pr-1">
          {!isInProgress && duration && (
            <span className="w-10 text-right text-[11px] text-ink-4">{duration}</span>
          )}
          {step.cellStatus === 'timeout' && (
            <span
              className="rounded-md border border-line bg-surface-2 px-1.5 py-px text-[10px] uppercase tracking-wider text-danger"
              title="This cell was stopped — it timed out or went silent. The next cell should be smaller, or split the work across cells."
            >
              timed out
            </span>
          )}
          {step.cellStatus === 'error' && (
            <span
              className="h-1.5 w-1.5 flex-none rounded-full bg-yellow-400"
              style={{ animation: 'step-error-dot-fade 4s ease-out forwards' }}
              title="This cell ended with an error."
            />
          )}
          {step.badge === 'Artifact' && (
            <span className="rounded-md border border-line bg-surface-2 px-1.5 py-px text-[10px] uppercase tracking-wider text-ink-4">
              artifact
            </span>
          )}
          {step.badge === 'AskUser' && (
            <span className="rounded-md border border-line bg-surface-2 px-1.5 py-px text-[10px] uppercase tracking-wider text-ink-4">
              question
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
