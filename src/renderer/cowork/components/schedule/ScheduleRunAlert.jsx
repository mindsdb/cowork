// `<ScheduleRunAlert>` — what a schedule's detail page says about how its
// last run went, when there is something to act on: an auto-pause, or a run
// that failed. Each says what is known about whether the run did anything,
// and offers the run's output (Review run) before anything that runs again.
//
// Resume waits for the next scheduled time; Run now / Run again runs once,
// now. Neither is offered while a run is still going.

import { Alert, Button } from '../ui';
import { relativeTime } from '../../lib/formatTime';
import { lastRunFailed, scheduleState } from './ScheduleStatusBadge';

// Outcomes after which some of the run's actions may have happened.
const MAY_HAVE_ACTED = new Set(['failed_during_execution', 'interrupted', 'uncertain']);

export function runAlert(task) {
  const state = scheduleState(task);
  const run = task.lastRun || null;
  const reason = run?.error || task.lastError || null;
  if (state === 'auto_paused') {
    return {
      kind: 'auto_paused',
      variant: 'danger',
      title: task.consecutiveFailures
        ? `Paused after ${task.consecutiveFailures} failed runs in a row`
        : 'Paused after repeated failed runs',
      reason,
      note: 'Resume picks up at the next scheduled time. Run now runs it once, now.',
    };
  }
  if (task.running || !lastRunFailed(task)) return null;
  if (MAY_HAVE_ACTED.has(run?.outcome)) {
    return {
      kind: 'partial',
      variant: 'warning',
      title: 'The last run stopped partway',
      reason,
      note: 'Some of its actions may have completed. Review the run before running it again.',
    };
  }
  return {
    kind: 'failed',
    variant: 'danger',
    title: task.retryAt ? 'The last run failed before it started work' : 'The last run failed',
    reason,
    note: task.retryAt ? `It will be tried again ${relativeTime(task.retryAt) ?? 'shortly'}.` : null,
  };
}

export default function ScheduleRunAlert({ task, busy, onResume, onRunNow, onReviewRun }) {
  const alert = runAlert(task);
  if (!alert) return null;
  const conversationId = task.lastRun?.conversationId || null;
  return (
    <Alert variant={alert.variant} title={alert.title}>
      <div className="flex flex-col gap-2">
        {alert.reason && <span>{alert.reason}</span>}
        {alert.note && <span>{alert.note}</span>}
        <div className="flex flex-wrap gap-2">
          {alert.kind === 'auto_paused' && (
            <Button size="sm" onClick={() => onResume?.(task.id)} disabled={busy}>Resume</Button>
          )}
          {conversationId && (
            <Button size="sm" onClick={() => onReviewRun?.(conversationId)}>Review run</Button>
          )}
          {alert.kind === 'partial' && (
            <Button size="sm" onClick={() => onRunNow?.(task.id)} disabled={busy || task.running}>Run again</Button>
          )}
        </div>
      </div>
    </Alert>
  );
}
