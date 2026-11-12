import { host } from '../../platform/host';
import i18n from '../../lib/i18n';

const msg = (key) => i18n.t(`messages.scheduleCopy.${key}`, { ns: 'projects' });

// What a scheduled task does when it couldn't run at its time. One sentence
// per cadence, shown when the task is created or edited and on its page, so
// the two never disagree. It has to match the server's rule: a recurring task
// runs its latest missed time once, from the last 7 days; a one-off runs up to
// an hour late, and after that waits for Run now.
//
// Desktop runs its own server, so a task misses its time when the app is
// closed. Web builds run tasks on a server that stays up, so only an outage
// makes one miss. `onServer` defaults to the current host.
export function missedRunText(cadence, onServer = host.isWeb) {
  if (cadence === 'once') return msg(onServer ? 'missedOnceServer' : 'missedOnceApp');
  return msg(onServer ? 'missedRecurringServer' : 'missedRecurringApp');
}

// The accessible name of the control that shows missedRunText.
export function missedRunLabel(onServer = host.isWeb) {
  return msg(onServer ? 'missedLabelServer' : 'missedLabelApp');
}

// Title for a one-off that ran out of its hour without running.
export function missedOnceTitle(onServer = host.isWeb) {
  return msg(onServer ? 'missedOnceTitleServer' : 'missedOnceTitleApp');
}
