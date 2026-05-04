// Three-phase Progress card body. Synthesises Thinking → Working
// (per cell) → Reasoning rows from the raw step list, plus rotating
// witty phrases per active phase.
//
// `streamStatus` decides bookend phases:
//   - 'thinking' / 'streaming' → response is in flight
//   - 'done'                   → all phases resolved
//
// Click any row to surface its scratchpad in the modal (when wired).

import { Fragment } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { usePhraseRotation } from '../../lib/usePhraseRotation';

function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function PhaseRow({
  bank, phaseKey, status, label, sublabel, hint, onClick,
}) {
  const isActive = status === 'in_progress';
  const isDone = status === 'completed';
  const phrase = usePhraseRotation(bank, phaseKey, { active: isActive });
  // Active phases display the rotating witty phrase; resolved phases
  // keep the static label so the user can re-read what happened.
  const displayLabel = isActive ? phrase : (label || phrase);
  return (
    <div
      onClick={onClick}
      className={clsx(
        'flex items-start gap-2.5 py-1',
        onClick && 'cursor-pointer'
      )}
      title={sublabel || displayLabel}
    >
      <span
        className={clsx(
          'mt-1 flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full',
          isDone && 'bg-accent border-[1.4px] border-accent text-white',
          isActive && 'border-[1.4px] border-accent',
          !isDone && !isActive && 'border-[1.4px] border-line'
        )}
      >
        {isDone && Ico.check(9)}
        {isActive && (
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        )}
      </span>
      <span className={clsx(
        'flex-1 min-w-0 text-[12.5px]',
        isDone ? 'text-ink-3' : 'text-ink-2'
      )}>
        <span className="block truncate">{displayLabel}</span>
        {sublabel && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-4">
            {sublabel}
          </span>
        )}
      </span>
      {hint && (
        <span className="ml-1 flex-none text-[10.5px] font-mono text-ink-4">
          {hint}
        </span>
      )}
    </div>
  );
}

export function PhaseProgress({ steps = [], streamStatus = null, conversationId = '', onActivateStep }) {
  const scratchpadSteps = steps.filter((s) => s._isScratchpad);
  const artifactSteps = steps.filter((s) => s.badge === 'Artifact');
  const isInFlight = streamStatus === 'thinking' || streamStatus === 'streaming';
  const isDone = streamStatus === 'done';

  // Thinking phase: appears the moment a request fires, resolves
  // when the first scratchpad cell starts (or the response goes
  // straight to the body for "no compute" answers).
  const thinkingStatus =
    scratchpadSteps.length === 0 && !isDone
      ? 'in_progress'
      : 'completed';

  // Reasoning phase: appears once cells are done and the body is
  // streaming, resolves at response.completed.
  const reasoningStatus =
    !isInFlight && isDone
      ? 'completed'
      : (scratchpadSteps.length > 0 && scratchpadSteps.every((s) => s.status === 'completed') && isInFlight)
        ? 'in_progress'
        : 'pending';

  // Don't render the card before anything has happened.
  if (!isInFlight && !isDone && steps.length === 0) {
    return (
      <p className="px-1 py-2 text-[12.5px] text-ink-4">
        Steps appear here while Anton works.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 pt-1">
      <PhaseRow
        bank="thinking"
        phaseKey={`${conversationId}:thinking`}
        status={thinkingStatus}
        label={thinkingStatus === 'completed' ? 'Thought it through' : null}
      />

      {scratchpadSteps.map((step) => {
        const reasoningMs =
          step.executionStartedAt && step.reasoningStartedAt
            ? step.executionStartedAt - step.reasoningStartedAt
            : null;
        const executionMs =
          step.executionCompletedAt && step.executionStartedAt
            ? step.executionCompletedAt - step.executionStartedAt
            : null;
        const totalMs =
          step.completedAt && step.startedAt ? step.completedAt - step.startedAt : null;

        // The hint shows the most informative timing we have.
        let hint = null;
        if (step.status === 'completed') {
          const r = formatDuration(reasoningMs);
          const x = formatDuration(executionMs);
          if (r && x) hint = `${r} · ${x}`;
          else hint = formatDuration(totalMs);
        }

        // Match the past-tense flip the Thinking and Reasoning rows
        // get when they resolve. Without this the row keeps the
        // present-tense rotating phrase ("Crunching the numbers")
        // forever, which read as "still working" even though the
        // step had finished.
        const isComplete = step.status !== 'in_progress';
        return (
          <PhaseRow
            key={step.id}
            bank="working"
            phaseKey={step.id}
            status={isComplete ? 'completed' : 'in_progress'}
            label={isComplete ? 'Worked through it' : null}
            sublabel={step.data?.one_line_description || step.label}
            hint={hint}
            onClick={onActivateStep ? () => onActivateStep(step) : undefined}
          />
        );
      })}

      {artifactSteps.map((step) => (
        <PhaseRow
          key={step.id}
          bank="working"
          phaseKey={`art-${step.id}`}
          status="completed"
          label="Wrapped up an artifact"
          sublabel={step.data?.title || step.data?.file_path || step.label}
          onClick={onActivateStep ? () => onActivateStep(step) : undefined}
        />
      ))}

      {(reasoningStatus === 'in_progress' || reasoningStatus === 'completed') && (
        <PhaseRow
          bank="reasoning"
          phaseKey={`${conversationId}:reasoning`}
          status={reasoningStatus}
          label={reasoningStatus === 'completed' ? 'Wrapped up the answer' : null}
        />
      )}
    </div>
  );
}
