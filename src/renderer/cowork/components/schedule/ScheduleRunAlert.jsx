// `<ScheduleRunAlert>` — what a schedule's detail page says about how its
// last run went, when there is something to act on: a pause with a run still
// finishing, a missed one-off, an auto-pause, or a run that failed. Each says what is known about whether the run did anything,
// and offers the run's output (Review run) before anything that runs again.
//
// Resume waits for the next scheduled time; Run now / Run again runs once,
// now. Neither is offered while a run is still going.

import { Alert, Button } from '../ui';
import Ico from '../Icons';
import { relativeTime } from '../../lib/formatTime';
import { lastRunFailed, scheduleState } from './ScheduleStatusBadge';

// Outcomes after which some of the run's actions may have happened.
const MAY_HAVE_ACTED = new Set(['failed_during_execution', 'interrupted', 'uncertain']);

export function runAlert(task) {
  const state = scheduleState(task);
  const run = task.lastRun || null;
  const reason = run?.error || task.lastError || null;
  if (task.running && (state === 'paused' || state === 'auto_paused')) {
    return {
      kind: 'finishing',
      variant: 'info',
      title: 'Paused — the current run will finish',
      reason: null,
      note: 'Nothing runs after it. Stop run ends it now; anything it has already done stays done.',
    };
  }
  if (state === 'missed') {
    return {
      kind: 'missed',
      variant: 'warning',
      title: 'This one-time task’s time passed while MindsHub was closed',
      reason: null,
      note: 'It was more than an hour late, so it didn’t run on its own. Run it now, or edit it to give it a new time.',
    };
  }
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
  const conversationId = alert.kind === 'finishing' || alert.kind === 'missed'
    ? null
    : task.lastRun?.conversationId || null;
  // The action that answers the alert comes first, as the primary button.
  const actions = [
    alert.kind === 'auto_paused' && (
      <Button key="resume" size="sm" variant="primary" onClick={() => onResume?.(task.id)} disabled={busy}>Resume</Button>
    ),
    alert.kind === 'missed' && (
      <Button key="run" size="sm" variant="primary" onClick={() => onRunNow?.(task.id)} disabled={busy}>Run now</Button>
    ),
    conversationId && (
      <Button key="review" size="sm" onClick={() => onReviewRun?.(conversationId)}>Review run</Button>
    ),
    alert.kind === 'partial' && (
      <Button key="again" size="sm" onClick={() => onRunNow?.(task.id)} disabled={busy || task.running}>Run again</Button>
    ),
  ].filter(Boolean);
  return (
    // The notice of a run still finishing changes as the run ends, so it is
    // announced politely; the others are alerts.
    <Alert
      variant={alert.variant}
      title={alert.title}
      icon={alert.variant === 'info' ? Ico.info(16) : Ico.warning(16)}
      role={alert.variant === 'info' ? 'status' : undefined}
      actions={actions.length ? actions : null}
    >
      {alert.reason && <p className="m-0">{alert.reason}</p>}
      {alert.note && <p className="m-0 mt-1 opacity-85">{alert.note}</p>}
    </Alert>
  );
}
