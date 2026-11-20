import { HABIT_TRACKER_PREFIX, ONBOARDING_STEPS } from './steps';
import { TASK_MODES, OWN_WORK_MODE, OWN_WORK_LEAD, OWN_WORK_START_NOW } from '../taskmodes/taskModes';
import { sampleId } from '../../lib/consoleHandoff';

// Which onboarding steps a message sent from the home composer completes, no
// matter which surface filled the composer (a console link, the sidebar
// checklist, an example, or the person typing it by hand).
//
// An example counts when it goes out as placed or with the person's edits or
// details added after it, the same rule the analytics use to name it; the habit
// tracker is recognized by its prefix so a lightly edited send still counts, as
// it did before the examples were open to every mode.
export function stepsCompletedBySend(text) {
  if (typeof text !== 'string') return [];
  const sent = text.trim();
  if (!sent) return [];
  const ids = [];
  if (ownWorkStart(sent)) ids.push('bring-your-work');
  const isExample = TASK_MODES.some((mode) =>
    mode.samples.some((s) => sent.startsWith(s.prompt))
  );
  if (isExample || sent.startsWith(HABIT_TRACKER_PREFIX)) ids.push('see-it-work');
  return ids;
}

// A message the own-work mode composed: the job (or the generic first step),
// the start-now line, then the person's material. Answers the job, if any,
// and how much material follows, or null for any other message.
function ownWorkStart(sent) {
  for (const lead of [OWN_WORK_LEAD, ...OWN_WORK_MODE.samples.map((j) => j.prompt)]) {
    const head = `${lead} ${OWN_WORK_START_NOW}`;
    if (sent.startsWith(head)) {
      const job = lead === OWN_WORK_LEAD ? null : OWN_WORK_MODE.samples.find((j) => j.prompt === lead);
      return { job, added_chars: sent.slice(head.length).trim().length };
    }
  }
  return null;
}

// The instruction line a selected mode pill appends to an edited message is
// the app's, not the person's, so it is taken off before the message is read.
function withoutModeInstruction(sent) {
  for (const mode of TASK_MODES) {
    const tail = mode.instruction ? `\n\n${mode.instruction}` : '';
    if (tail && sent.endsWith(tail)) return sent.slice(0, -tail.length);
  }
  return sent;
}

// What kind of start a new task's first message was, for analytics. The text
// itself is never kept: only the kind, the example's id, and how much the
// person added to a start or example (a paste, or details). It reads the
// message as sent, so an example the person edited still counts as that example.
export function classifyStart(text) {
  const sent = withoutModeInstruction(typeof text === 'string' ? text.trim() : '');
  const own = ownWorkStart(sent);
  if (own) {
    const start = { start_kind: 'own_work', added_chars: own.added_chars };
    if (own.job) start.example_id = sampleId(own.job.label);
    return start;
  }
  const step = ONBOARDING_STEPS.find((s) => s.prompt && s.prompt === sent);
  if (step) return { start_kind: 'onboarding_step', example_id: step.id };
  for (const mode of TASK_MODES) {
    for (const sample of mode.samples) {
      if (sample.prompt === sent) {
        return { start_kind: 'example', example_id: sampleId(sample.label), added_chars: 0 };
      }
      if (sent.startsWith(sample.prompt)) {
        return { start_kind: 'example', example_id: sampleId(sample.label), added_chars: sent.length - sample.prompt.length };
      }
    }
  }
  if (sent.startsWith(HABIT_TRACKER_PREFIX)) {
    return { start_kind: 'example', example_id: sampleId('Build a habit tracker'), added_chars: null };
  }
  return { start_kind: 'free_text' };
}
