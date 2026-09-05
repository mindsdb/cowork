// Show one progress indicator per turn. Expand when inspectable steps first arrive and collapse on
// completion.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { Tooltip } from '../ui';
import { ThinkingStep } from './ThinkingStep';
import { WorkingIndicator } from './WorkingIndicator';
import { truncateLabel } from '../../lib/responseStreamAdapter';

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
  currentThought = null,
  slotId = null,
  onActivateStep,
}) {
  const hasSteps = steps.length > 0;
  const hasInspectableSteps = useMemo(
    () => steps.some((s) => s._isScratchpad || s._isToolCall),
    [steps]
  );
  const hasLiveThought = isActive && Boolean(currentThought?.text);

  const [isExpanded, setIsExpanded] = useState(
    () => isActive && (hasInspectableSteps || Boolean(currentThought?.text))
  );
  const hasAutoExpanded = useRef(false);

  // Expand on the first live inspectable step or thought; completed blocks mount collapsed.
  useEffect(() => {
    if (isActive && (hasInspectableSteps || hasLiveThought) && !hasAutoExpanded.current) {
      setIsExpanded(true);
      hasAutoExpanded.current = true;
    }
  }, [isActive, hasInspectableSteps, hasLiveThought]);

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

  // Expose timeouts in the collapsed header so retry loops cannot look like progressing work.
  const timedOutCount = useMemo(
    () => steps.filter((s) => s.cellStatus === 'timeout').length,
    [steps]
  );

  const toggleExpanded = useCallback(() => setIsExpanded((p) => !p), []);

  if (!isActive && !hasSteps) return null;

  return (
    <div className="w-full">
      <Tooltip content={isExpanded ? 'Hide thought process' : 'Show thought process'}>
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
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
      </Tooltip>

      {isExpanded && (hasSteps || (isActive && currentThought?.text)) && (
        <div className="ml-0 mt-1">
          {steps.map((step, index) => (
            <ThinkingStep
              key={step.id}
              step={step}
              isFirst={index === 0}
              isLast={!currentThought?.text && index === steps.length - 1}
              onActivate={onActivateStep}
            />
          ))}
          {/*
 * Live thought text is transient and distinct from persisted steps; hide it when the burst or turn
 * ends.
 */}
          {isActive && currentThought?.text && (
            <div className="flex gap-1.5">
              <div className="flex w-4 flex-col items-center">
                <div className={clsx('w-px flex-1', hasSteps ? 'bg-line-2' : 'bg-transparent')} />
                <div className="my-0.5 flex h-4 w-4 flex-none items-center justify-center">
                  <span className="pulse-dot inline-block h-1.5 w-1.5 flex-none rounded-full bg-ink-4" />
                </div>
                <div className="w-px flex-1 bg-transparent" />
              </div>
              <div className="flex min-w-0 flex-1 items-center py-1.5">
                <span
                  className="thinking-shimmer min-w-0 truncate px-1 text-[12.5px] italic"
                  title={currentThought.text}
                >
                  {truncateLabel(currentThought.text)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
