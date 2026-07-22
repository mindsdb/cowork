import { Badge } from '../ui';

export function scheduleStatusBadge(task, failedLabel = 'Last failed') {
  if (task.running) return { label: 'Running', variant: 'accent' };
  if (!task.enabled) return { label: 'Paused', variant: 'muted' };
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
