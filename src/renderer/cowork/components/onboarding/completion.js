import { OWN_WORK_PREFIX, HABIT_TRACKER_PREFIX } from './steps';
import { TASK_MODES } from '../taskmodes/taskModes';

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
