import { Badge } from '../ui';

export function scheduleStatusBadge(task, failedLabel = 'Last failed') {
  if (task.running) return { label: 'Running', variant: 'accent' };
  // Paused by the server after repeated failures, not by the user.
  if (!task.enabled && task.autoPausedAt) return { label: 'Auto-paused', variant: 'danger' };
  if (!task.enabled) return { label: 'Paused', variant: 'muted' };
  // A failed run waiting to be tried again.
  if (task.retryAt) return { label: 'Retrying', variant: 'warning' };
  if (task.lastError) return { label: failedLabel, variant: 'danger' };
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
