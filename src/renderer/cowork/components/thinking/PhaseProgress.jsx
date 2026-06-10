// Three-phase Progress card body for the right rail. Always renders
// at most three rows — Thinking → Working → Reasoning — regardless of
// how many scratchpad cells the turn produced. The Working row's
// sublabel updates while a cell is in-flight to surface what Anton is
// actually doing right now; on completion all three rows flip to
// past-tense headlines (variants picked deterministically per turn).
//
// `streamStatus` decides bookend phases:
//   - 'thinking' / 'streaming' → response is in flight
//   - 'done'                   → all phases resolved
//
// Click the Working row to open the scratchpad modal focused on the
// most recent / currently-active cell. Artifacts are rendered as
// separate rows after the three phases.

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

// Past-tense headline banks. We pick deterministically per turn (using
// the conversation id + phase as the seed) so the same conversation
// renders the same headline across re-renders, but two different
// conversations rotate through variants. Mirrors the playful tone of
// the in-flight phrase banks while reading as "this is done".
const COMPLETED_LABELS = {
  thinking: [
    'Thought it through',
    'Mapped it out',
    'Lined up the steps',
    'Picked the angle',
    'Sketched the approach',
  ],
  working: [
    'Worked through it',
    'Crunched the numbers',
    'Did the heavy lifting',
    'Pulled it together',
    'Followed the breadcrumbs',
  ],
  reasoning: [
    'Wrapped up the answer',
    'Tied it together',
    'Distilled the result',
    'Composed the response',
    'Made it readable',
  ],
};

// djb2 hash for stable picks per (conversationId, phase).
function _hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickCompletedLabel(phase, key) {
  const list = COMPLETED_LABELS[phase] || [];
  if (list.length === 0) return null;
  return list[_hash(String(key || phase)) % list.length];
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
  const scratchpadSteps = steps.filter((s) => s._isScratchpad || s._isToolCall);
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
        Steps appear here while the agent works.
      </p>
    );
  }

  // Working phase — one row regardless of cell count. While any cell
  // is in-flight the row is active; once they're all done it flips to
  // the past-tense headline. The sublabel surfaces the current cell's
  // one-liner so the user sees what's happening right now.
  const workingActive = scratchpadSteps.some((s) => s.status === 'in_progress');
  const workingStarted = scratchpadSteps.length > 0;
  const workingDone = workingStarted && !workingActive;
  const workingStatus = workingActive
    ? 'in_progress'
    : workingDone
      ? 'completed'
      : 'pending';

  // Pick the cell to feature as the row's sublabel — most recent
  // in-flight while running, last completed once everything's done
  // (so a user opening the scratchpad lands on the latest cell).
  const focusCell = workingActive
    ? [...scratchpadSteps].reverse().find((s) => s.status === 'in_progress')
    : scratchpadSteps[scratchpadSteps.length - 1] || null;

  // Total duration across every cell — most useful summary stat for
  // the completed Working row. Falls back to per-cell startedAt /
  // completedAt; gaps between cells just count as part of the run.
  let workingTotalMs = null;
  if (workingDone && scratchpadSteps.length > 0) {
    const earliestStart = scratchpadSteps.reduce(
      (m, s) => (s.startedAt && (m == null || s.startedAt < m)) ? s.startedAt : m,
      null,
    );
    const latestEnd = scratchpadSteps.reduce(
      (m, s) => (s.completedAt && (m == null || s.completedAt > m)) ? s.completedAt : m,
      null,
    );
    if (earliestStart && latestEnd) workingTotalMs = latestEnd - earliestStart;
  }

  return (
    <div className="flex flex-col gap-1 pt-1">
      <PhaseRow
        bank="thinking"
        phaseKey={`${conversationId}:thinking`}
        status={thinkingStatus}
        label={
          thinkingStatus === 'completed'
            ? pickCompletedLabel('thinking', `${conversationId}:thinking`)
            : null
        }
      />

      {workingStarted && (
        <PhaseRow
          bank="working"
          phaseKey={`${conversationId}:working`}
          status={workingStatus}
          label={
            workingStatus === 'completed'
              ? pickCompletedLabel('working', `${conversationId}:working`)
              : null
          }
          sublabel={
            workingActive
              ? (focusCell?.data?.one_line_description || focusCell?.label || null)
              : null
          }
          hint={workingStatus === 'completed' ? formatDuration(workingTotalMs) : null}
          onClick={
            onActivateStep && focusCell
              ? () => onActivateStep(focusCell)
              : undefined
          }
        />
      )}

      {(reasoningStatus === 'in_progress' || reasoningStatus === 'completed') && (
        <PhaseRow
          bank="reasoning"
          phaseKey={`${conversationId}:reasoning`}
          status={reasoningStatus}
          label={
            reasoningStatus === 'completed'
              ? pickCompletedLabel('reasoning', `${conversationId}:reasoning`)
              : null
          }
        />
      )}

      {/* Artifacts are not part of the 3-phase rhythm — they're
          file-output checkpoints. Rendered after the phases so the
          three-step shape stays clean. */}
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
    </div>
  );
}
