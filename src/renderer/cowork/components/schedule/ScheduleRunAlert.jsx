// `<ScheduleRunAlert>` — what a schedule's detail page says about how its
// last run went, when there is something to act on: a pause with a run still
// finishing, a missed one-off, an auto-pause, a run that stopped at a limit,
// or a run that failed. Each says
// what is known about whether the run did anything, and offers the run's
// output (Review run) before anything that runs again.
//
// Resume may catch up a pending run; Run now / Run again runs once,
// now. Neither is offered while a run is still going.

import { Alert, Button } from '../ui';
import i18n, { useTranslation } from '../../../lib/i18n';
import { missedOnceTitle } from '../../lib/scheduleCopy';
import { lastRunFailed, lastRunStoppedAtLimit, scheduleState } from './ScheduleStatusBadge';

// Outcomes after which some of the run's actions may have happened.
const MAY_HAVE_ACTED = new Set(['failed_during_execution', 'interrupted', 'uncertain']);

const msg = (key, vars) => i18n.t(`scheduleRunAlert.${key}`, { ns: 'projects', ...vars });

export function runAlert(task) {
  const state = scheduleState(task);
  const run = task.lastRun || null;
  const reason = run?.error || task.lastError || null;
  if (task.running && (state === 'paused' || state === 'auto_paused')) {
    return {
      kind: 'finishing',
      variant: 'info',
      title: msg('finishingTitle'),
      reason: null,
      note: msg('finishingNote'),
    };
  }
  if (state === 'missed') {
    return {
      kind: 'missed',
      variant: 'warning',
      title: missedOnceTitle(),
      reason: null,
      note: msg('missedNote'),
    };
  }
  if (state === 'auto_paused') {
    return {
      kind: 'auto_paused',
      variant: 'danger',
      title: task.consecutiveFailures
        ? msg('autoPausedTitleCount', { count: task.consecutiveFailures })
        : msg('autoPausedTitle'),
      reason,
      note: msg('autoPausedNote'),
    };
  }
  if (task.running || !lastRunFailed(task)) return null;
  if (lastRunStoppedAtLimit(task)) {
    // The reason names the limit; Settings is where it is raised.
    return {
      kind: 'limit',
      variant: 'warning',
      title: msg('limitTitle'),
      reason,
      note: msg('limitNote'),
    };
  }
  if (MAY_HAVE_ACTED.has(run?.outcome)) {
    return {
      kind: 'partial',
      variant: 'warning',
      title: msg('partialTitle'),
      reason,
      note: msg('partialNote'),
    };
  }
  return {
    kind: 'failed',
    variant: 'danger',
    title: msg('failedTitle'),
    reason,
  };
}

export default function ScheduleRunAlert({ task, busy, onResume, onRunNow, onReviewRun, onOpenSettings }) {
  const { t } = useTranslation('projects');
  const alert = runAlert(task);
  if (!alert) return null;
  const conversationId = alert.kind === 'finishing' || alert.kind === 'missed'
    ? null
    : task.lastRun?.conversationId || null;
  // The action that answers the alert comes first as a default button; the
  // rest are subtle.
  const actions = [
    alert.kind === 'auto_paused' && (
      <Button key="resume" size="sm" onClick={() => onResume?.(task.id)} disabled={busy}>{t('scheduleRunAlert.resume')}</Button>
    ),
    alert.kind === 'missed' && (
      <Button key="run" size="sm" onClick={() => onRunNow?.(task.id)} disabled={busy}>{t('scheduleRunAlert.runNow')}</Button>
    ),
    conversationId && (
      <Button key="review" size="sm" variant={alert.kind === 'partial' || alert.kind === 'limit' || alert.kind === 'failed' ? 'default' : 'subtle'} onClick={() => onReviewRun?.(conversationId)}>{t('scheduleRunAlert.reviewRun')}</Button>
    ),
    alert.kind === 'limit' && onOpenSettings && (
      <Button key="settings" size="sm" variant="subtle" onClick={() => onOpenSettings('agent')}>{t('scheduleRunAlert.openSettings')}</Button>
    ),
    (alert.kind === 'partial' || alert.kind === 'limit') && (
      <Button key="again" size="sm" variant="subtle" onClick={() => onRunNow?.(task.id)} disabled={busy || task.running}>{t('scheduleRunAlert.runAgain')}</Button>
    ),
  ].filter(Boolean);
  return (
    // The notice of a run still finishing changes as the run ends, so it is
    // announced politely; the others are alerts.
    <Alert
      variant={alert.variant}
      title={alert.title}
      role={alert.variant === 'info' ? 'status' : undefined}
      actions={actions.length ? actions : null}
    >
      {alert.reason && <p className="m-0">{alert.reason}</p>}
      {alert.note && <p className="m-0 mt-1 text-ink-3">{alert.note}</p>}
    </Alert>
  );
}
