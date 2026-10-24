import { host } from '../../platform/host';

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
  const absent = onServer ? 'the server is down' : 'MindsHub is closed';
  const back = onServer ? 'it’s back' : 'it reopens';
  if (cadence === 'once') {
    return `If ${absent} at this time, the task runs when ${back} within the hour. After that it’s marked missed, and you can run it yourself.`;
  }
  return `If ${absent} when this is due, the task runs once when ${back}, for the latest time it missed. Earlier missed times are skipped.`;
}

// The accessible name of the control that shows missedRunText.
export function missedRunLabel(onServer = host.isWeb) {
  return onServer ? 'If the server is down at this time' : 'If MindsHub is closed at this time';
}

// Title for a one-off that ran out of its hour without running.
export function missedOnceTitle(onServer = host.isWeb) {
  return onServer
    ? 'This one-time task’s time passed while the server was down'
    : 'This one-time task’s time passed while MindsHub was closed';
}

// Past-tense pieces for runs that were skipped: why ("while MindsHub was
// closed") and when the latest one ran instead ("when it reopened").
export function missedRunPast(onServer = host.isWeb) {
  return onServer
    ? { absent: 'while the server was down', back: 'when it was back' }
    : { absent: 'while MindsHub was closed', back: 'when it reopened' };
}
