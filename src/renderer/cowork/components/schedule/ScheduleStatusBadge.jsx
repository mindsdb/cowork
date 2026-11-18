import { Badge } from '../ui';
import i18n from '../../../lib/i18n';

const label = (key) => i18n.t(`scheduleStatus.${key}`, { ns: 'projects' });

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

// Whether the latest finished run stopped at a step, token or continuation
// limit before it finished. The server records it as failed, with the setting
// to raise as its error.
export function lastRunStoppedAtLimit(task) {
  return task.lastRun?.status === 'failed' && task.lastRun.outcome === 'stopped_at_limit';
}

export function scheduleStatusBadge(task, failedLabel = label('lastFailed')) {
  const state = scheduleState(task);
  if (task.running) {
    // Paused while a run was going: that run finishes, and nothing else starts
    // until the task is resumed.
    if (state === 'paused' || state === 'auto_paused') return { label: label('pausedFinishing'), variant: 'accent' };
    return { label: label('running'), variant: 'accent' };
  }
  // Paused by the server after repeated failures, not by the user.
  if (state === 'auto_paused') return { label: label('autoPaused'), variant: 'danger' };
  if (state === 'paused') return { label: label('paused'), variant: 'muted' };
  // A one-off whose time passed while the app was closed; Run now runs it.
  if (state === 'missed') return { label: label('missed'), variant: 'warning' };
  if (lastRunStoppedAtLimit(task)) return { label: label('stoppedAtLimit'), variant: 'warning' };
  if (lastRunFailed(task)) return { label: failedLabel, variant: 'danger' };
  if (state === 'done') return { label: label('done'), variant: 'muted' };
  return { label: label('active'), variant: 'success' };
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
