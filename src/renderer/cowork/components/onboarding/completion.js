import { OWN_WORK_PREFIX, OWN_WORK_PROMPT, HABIT_TRACKER_PREFIX, ONBOARDING_STEPS } from './steps';
import { TASK_MODES } from '../taskmodes/taskModes';
import { sampleId } from '../../lib/consoleHandoff';

// Which onboarding steps a message sent from the home composer completes, no
// matter which surface filled the composer (a console link, the sidebar
// checklist, an example, or the person typing it by hand).
//
// An example counts when it goes out as placed, or, for a plain one, with the
// person's paste or details added after it; the habit tracker is recognized by
// its prefix so a lightly edited send still counts, as it did before the
// examples were open to every mode.
export function stepsCompletedBySend(text) {
  if (typeof text !== 'string') return [];
  const sent = text.trim();
  if (!sent) return [];
  const ids = [];
  if (sent.startsWith(OWN_WORK_PREFIX)) ids.push('bring-your-work');
  const isExample = TASK_MODES.some((mode) =>
    mode.samples.some((s) => s.prompt === sent || (s.plain && sent.startsWith(s.prompt)))
  );
  if (isExample || sent.startsWith(HABIT_TRACKER_PREFIX)) ids.push('see-it-work');
  return ids;
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
  if (sent.startsWith(OWN_WORK_PREFIX)) {
    return { start_kind: 'own_work', added_chars: Math.max(0, sent.length - OWN_WORK_PROMPT.length) };
  }
  const step = ONBOARDING_STEPS.find((s) => s.prompt && s.id !== 'bring-your-work' && s.prompt === sent);
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
    return { start_kind: 'example', example_id: 'build-a-habit-tracker', added_chars: null };
  }
  return { start_kind: 'free_text' };
}
