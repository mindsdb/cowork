// Collapsible thinking block above an assistant answer — the ONE
// in-progress indicator for a turn.
//
// The parent owns the steps array, the active state and the start time;
// we just render. The header is clickable to expand/collapse the steps.
//
// Header states:
//   active + collapsed  →  [orb] <current step label>            (shimmer)
//   active + expanded   →  [orb] Working for 6s                  (live timer;
//                          the current step sits at the END of the list below)
//   finished            →  Worked for 3m 9s  ⌄                   (chevron always visible)
//   finished, no timing →  Thought process   ⌄                   (e.g. reopened
//                          conversations where the duration wasn't recoverable)
//
// The block auto-expands the first time inspectable steps stream in,
// and auto-collapses when the turn finishes — the finished header is a
// calm one-liner the user can reopen on demand.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { ThinkingStep } from './ThinkingStep';
import { WorkingIndicator } from './WorkingIndicator';

function formatDuration(ms) {
  if (ms == null || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Live "Working for 6s" text — ticks once a second while the turn runs.
function WorkingLabel({ startedAt }) {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.max(0, Date.now() - startedAt) : 0
  );
  useEffect(() => {
    if (!startedAt) return undefined;
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="tabular-nums">Working for {formatDuration(elapsed)}</span>;
}

export function ThinkingBlock({
  steps = [],
  isActive = false,
  startedAt = null,
  currentLabel = null,
  slotId = null,
  onActivateStep,
}) {
  const hasSteps = steps.length > 0;
  const hasInspectableSteps = useMemo(
    () => steps.some((s) => s._isScratchpad || s._isToolCall),
    [steps]
  );

  const [isExpanded, setIsExpanded] = useState(() => isActive && hasInspectableSteps);
  const hasAutoExpanded = useRef(false);

  // Auto-expand the first time scratchpad or tool-call steps appear —
  // but only while the turn is live. Finished blocks mount collapsed.
  useEffect(() => {
    if (isActive && hasInspectableSteps && !hasAutoExpanded.current) {
      setIsExpanded(true);
      hasAutoExpanded.current = true;
    }
  }, [isActive, hasInspectableSteps]);

  // Auto-collapse when the turn finishes.
  const wasActive = useRef(isActive);
  useEffect(() => {
    if (wasActive.current && !isActive) setIsExpanded(false);
    wasActive.current = isActive;
  }, [isActive]);

  const finalDuration = useMemo(() => {
    if (!isActive && startedAt && steps.length > 0) {
      const last = steps[steps.length - 1];
      if (last.completedAt) return formatDuration(last.completedAt - startedAt);
    }
    return null;
  }, [isActive, startedAt, steps]);

  // Glanceable kill signal: how many cells timed out / were killed. Surfaced
  // in the (collapsed) header so a retry-on-timeout loop is visible without
  // expanding — otherwise a ticking timer looks identical to a cell that's
  // making progress. Expanding shows which cells via the per-row badge.
  const timedOutCount = useMemo(
    () => steps.filter((s) => s.cellStatus === 'timeout').length,
    [steps]
  );

  const toggleExpanded = useCallback(() => setIsExpanded((p) => !p), []);

  // Nothing to show: not active and no recorded steps.
  if (!isActive && !hasSteps) return null;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
        title={isExpanded ? 'Hide thought process' : 'Show thought process'}
        className={clsx(
          'group flex w-full cursor-pointer items-center gap-1 rounded-md py-1 text-left',
          'border-0 bg-transparent'
        )}
      >
        {isActive ? (
          <WorkingIndicator
            slotId={slotId}
            label={
              isExpanded
                ? <WorkingLabel startedAt={startedAt} />
                : (currentLabel || 'Thinking…')
            }
          />
        ) : (
          <>
            {/* Same size as the answer body (14.5px) — the header reads
                as part of the message, not as fine print. */}
            <span className="flex-none text-[14.5px] text-ink-3">
              {finalDuration ? `Worked for ${finalDuration}` : 'Thought process'}
            </span>
            <span
              className={clsx(
                'inline-flex flex-none items-center self-center text-ink-4',
                'transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            >
              {Ico.chevDown(16)}
            </span>
          </>
        )}

        {timedOutCount > 0 && (
          <span
            className="ml-2 flex-none rounded-md border border-line bg-surface-2 px-1.5 py-px text-[10px] uppercase tracking-wider text-danger"
            title={`${timedOutCount} cell${timedOutCount > 1 ? 's' : ''} timed out — the agent retried with smaller steps. Expand to see which.`}
          >
            {timedOutCount} timed out
          </span>
        )}
      </button>

      {isExpanded && hasSteps && (
        <div className="ml-0 mt-1">
          {steps.map((step, index, arr) => (
            <ThinkingStep
              key={step.id}
              step={step}
              isFirst={index === 0}
              isLast={index === arr.length - 1}
              onActivate={onActivateStep}
            />
          ))}
        </div>
      )}
    </div>
  );
}
