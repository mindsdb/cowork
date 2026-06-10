// Collapsible "Thinking…" block under the ANTON label of a turn.
//
// Adapted from mdb-ai/Message/ThinkingBlock/index.jsx — without jotai.
// The parent owns the steps array, the active state and the start time;
// we just render. The header is clickable to expand/collapse the steps.
//
// When `isActive` is true and there are no steps yet, we render the
// "Thinking..." header with a live timer. As steps arrive, the list
// expands automatically (mdb-ai auto-expands when scratchpad steps
// appear; we keep that).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { ThinkingStep } from './ThinkingStep';

function LiveTimer({ startedAt }) {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
  );
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="ml-auto text-[11px] text-ink-4">{elapsed}s</span>;
}

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

export function ThinkingBlock({
  steps = [],
  isActive = false,
  startedAt = null,
  currentLabel = null,
  onActivateStep,
}) {
  const hasSteps = steps.length > 0;
  const hasInspectableSteps = useMemo(
    () => steps.some((s) => s._isScratchpad || s._isToolCall),
    [steps]
  );

  const [isExpanded, setIsExpanded] = useState(() => hasInspectableSteps);
  const hasAutoExpanded = useRef(false);

  // Auto-expand the first time scratchpad or tool-call steps appear.
  useEffect(() => {
    if (hasInspectableSteps && !hasAutoExpanded.current) {
      setIsExpanded(true);
      hasAutoExpanded.current = true;
    }
  }, [hasInspectableSteps]);

  const finalDuration = useMemo(() => {
    if (!isActive && startedAt && steps.length > 0) {
      const last = steps[steps.length - 1];
      if (last.completedAt) return formatDuration(last.completedAt - startedAt);
    }
    return null;
  }, [isActive, startedAt, steps]);

  const toggleExpanded = useCallback(() => setIsExpanded((p) => !p), []);

  // Nothing to show: not active and no recorded steps.
  if (!isActive && !hasSteps) return null;

  return (
    <div className="w-full pt-1">
      <button
        type="button"
        onClick={toggleExpanded}
        title={isExpanded ? 'Hide details' : 'Show details'}
        className={clsx(
          'group flex w-full cursor-pointer items-center gap-1 rounded-md py-1 text-left',
          'transition-colors hover:bg-surface-2/60',
          'border-0 bg-transparent'
        )}
      >
        <span
          className={clsx(
            'flex-none text-ink-4 transition-transform duration-200',
            isExpanded && 'rotate-90'
          )}
        >
          {Ico.chevRight(14)}
        </span>

        {isActive ? (
          <>
            <span className="flex-none text-[12px] text-ink-3">
              {currentLabel || 'Thinking'}
            </span>
            <LiveTimer startedAt={startedAt} />
          </>
        ) : (
          <span className="flex-none text-[12px] text-ink-3">
            Worked for {finalDuration || '—'}
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
