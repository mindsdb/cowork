import { Badge } from '../ui';

// The server's derived state (`task.state`): active | paused | auto_paused |
// missed | done. Older servers send none; their tasks read from `enabled`.
export function scheduleState(task) {
  if (task.state) return task.state;
  if (!task.enabled && task.autoPausedAt) return 'auto_paused';
  if (!task.enabled) return task.cadence === 'once' ? 'done' : 'paused';
  return 'active';
}

// Whether the latest finished run failed. `lastRun` is the run itself; an
// older server only sends `lastError`, which a later success clears.
export function lastRunFailed(task) {
  if (task.lastRun) return task.lastRun.status === 'failed';
  return !!task.lastError;
}

export function scheduleStatusBadge(task, failedLabel = 'Last failed') {
  const state = scheduleState(task);
  if (task.running) {
    // Paused while a run was going: that run finishes, nothing follows it.
    if (state === 'paused' || state === 'auto_paused') return { label: 'Paused · finishing run', variant: 'accent' };
    return { label: 'Running', variant: 'accent' };
  }
  // Paused by the server after repeated failures, not by the user.
  if (state === 'auto_paused') return { label: 'Auto-paused', variant: 'danger' };
  if (state === 'paused') return { label: 'Paused', variant: 'muted' };
  // A one-off whose time passed while the app was closed; Run now runs it.
  if (state === 'missed') return { label: 'Missed', variant: 'warning' };
  // A failed run waiting to be tried again.
  if (task.retryAt) return { label: 'Retrying', variant: 'warning' };
  if (lastRunFailed(task)) return { label: failedLabel, variant: 'danger' };
  if (state === 'done') return { label: 'Done', variant: 'muted' };
  return { label: 'Active', variant: 'success' };
}

export function ScheduleStatusBadge({ task, failedLabel, ...props }) {
  const status = scheduleStatusBadge(task, failedLabel);
  return (
    <Badge variant={status.variant} {...props}>
      {status.label}
    </Badge>
  );
}

export default ScheduleStatusBadge;
