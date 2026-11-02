// One row inside the expanded ThinkingBlock. This file is Cowork's adapter
// onto the shared StepRow: it turns a responseStreamAdapter step into row
// props and leaves the drawing to StepRow (shared with Code Mode).
//
// Click handling is delegated via onActivate; the block passes it only to
// rows that open something (see isActivatableStep in ThinkingBlock).

import { StepRow } from '../steps/StepRow';
import { useTypedText } from './FirstTake';
import { stepDisplayLabel } from '../../lib/responseStreamAdapter';

const UNTIMED_BADGES = new Set(['ToolProgress', 'Artifact', 'Skill', 'Compaction']);

const OBJECT_TAGS = { Artifact: 'artifact', Skill: 'skill' };

function formatStepDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const seconds = Math.floor((completedAt - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// The opening Note's stand-in phrase types out like streamed text would.
function TypedStandIn({ text }) {
  return useTypedText(text);
}

/** Map a thinking step onto the shared step status vocabulary.
 *  A killed cell failed; a cell or tool that ended with an error is
 *  `recovered`, because the agent usually retries and moves on. */
export function thinkingStepStatus(step) {
  if (step?.status === 'in_progress') return { status: 'running' };
  if (step?.cellStatus === 'timeout') {
    return {
      status: 'failed',
      label: 'Timed out',
      title: 'This cell was stopped — it timed out or went silent. The next cell should be smaller, or split the work across cells.',
    };
  }
  if (step?.cellStatus === 'error') return { status: 'recovered', title: 'This cell ended with an error.' };
  return { status: 'done' };
}

/** The duration shown on a settled row, or null. No duration on a tool's
 *  step line: fullstack generation runs steps in parallel, so "time until
 *  the next line" is not how long the step took (ENG-2981). Nor on a row
 *  that marks a moment rather than work (an artifact, a skill, a
 *  compaction): it always read "0s". */
export function thinkingStepDuration(step) {
  if (!step || step.status === 'in_progress' || UNTIMED_BADGES.has(step.badge)) return null;
  return formatStepDuration(step.startedAt, step.completedAt);
}

export function ThinkingStep({
  step,
  isFirst = false,
  isLast = false,
  onActivate,
}) {
  const { status, label, title } = thinkingStepStatus(step);
  return (
    <StepRow
      variant="timeline"
      icon={step.icon}
      target={step.standIn ? <TypedStandIn text={step.standIn} /> : step.label}
      title={stepDisplayLabel(step)}
      // A Note is Anton's own sentence between steps: show all of it rather
      // than cutting it off mid-thought.
      wrap={step.badge === 'Note'}
      status={status}
      statusLabel={label}
      statusTitle={title}
      duration={thinkingStepDuration(step)}
      tag={OBJECT_TAGS[step.badge]}
      first={isFirst}
      last={isLast}
      onActivate={onActivate ? () => onActivate(step) : undefined}
    />
  );
}
