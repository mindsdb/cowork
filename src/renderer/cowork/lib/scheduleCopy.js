// What a scheduled task does when MindsHub was closed at its time. One
// sentence per cadence, shown when the task is created or edited and on its
// page, so the two never disagree. It has to match the server's rule: a
// recurring task runs its latest missed time once, from the last 7 days; a
// one-off runs up to an hour late, and after that waits for Run now.
export function missedRunText(cadence) {
  if (cadence === 'once') {
    return 'If MindsHub is closed at this time, the task runs when it reopens within the hour. After that it’s marked missed, and you can run it yourself.';
  }
  return 'If MindsHub is closed when this is due, the task runs once when it reopens, for the latest time it missed. Earlier missed times are skipped.';
}
