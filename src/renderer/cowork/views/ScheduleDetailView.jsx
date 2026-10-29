// `<ScheduleDetailView>` — one scheduled task.
//
// Header: the page header's trail (Scheduled Tasks) above the task's name,
// with status, the schedule in words and the next run under it, and the
// task's controls beside it: the on/off switch, Run now (Stop run while one
// is going) and the overflow menu.
// Summary: project, model and how many runs succeeded.
// Runs: the collection kit's list, newest first; each row opens the run's
// conversation. A failed run's reason is on its status, so the same reason
// repeated over a streak of failures doesn't fill the list; the alert above
// says the latest one in full.

import { useEffect, useMemo, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
import Ico from '../components/Icons';
import { ListGroup, ListItem, ListNotice, PageHeader, StatusDot } from '../components/collection';
import { Badge, Button, Tooltip } from '../components/ui';
import { useToastManager } from '../components/ui/Toast';
import { Switch } from '../components/ui/Switch';
import OverflowMenu from '../components/OverflowMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { fetchScheduleRuns } from '../api';
import ScheduleTaskModal from '../components/schedule/ScheduleTaskModal';
import { scheduleState, scheduleStatusBadge } from '../components/schedule/ScheduleStatusBadge';
import ScheduleRunAlert from '../components/schedule/ScheduleRunAlert';
import { missedRunText } from '../lib/scheduleCopy';
import { dateLocale, describeWhen, timeZoneLabel, whenFromDate } from '../lib/scheduleWhen';
import i18n, { useTranslation } from '../../lib/i18n';
import { relativeTime } from '../lib/formatTime';

// How many runs show before "Show older runs".
const RUNS_SHOWN = 20;

function absoluteTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(dateLocale(), {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// Labels are scheduleDetail.runStatus.<key>.
const RUN_STATUS = {
  running:   { tone: 'accent',  key: 'running' },
  success:   { tone: 'success', key: 'success' },
  failed:    { tone: 'danger',  key: 'failed' },
  cancelled: { tone: 'muted',   key: 'cancelled' },
};

const msg = (key, vars) => i18n.t(`scheduleDetail.${key}`, { ns: 'projects', ...vars });

// The schedule in words: "Every weekday at 9:00 AM, Los Angeles time". The
// time is shown in this computer's zone, so that is the zone it names.
function scheduleSentence(task) {
  if (!task.nextRunAt || Number.isNaN(new Date(task.nextRunAt).getTime())) return '';
  return msg('sentence', { when: describeWhen(whenFromDate(task.nextRunAt, task.cadence)), zone: timeZoneLabel() });
}

function nextRunText(task, state) {
  if (task.running) return msg('runningNow');
  // The status already says paused, missed or done.
  if (state !== 'active') return null;
  const when = relativeTime(task.nextRunAt);
  return when ? msg('nextRun', { when }) : null;
}

// A one-off with no time left to run at: it ran, it was missed, or it was
// paused and its time has passed since. Resuming any of these would be refused.
function oneOffWithoutTime(task, state) {
  if (task.cadence !== 'once') return false;
  if (state === 'done' || state === 'missed') return true;
  const at = Date.parse(task.nextRunAt);
  return state === 'paused' && Number.isFinite(at) && at <= Date.now();
}

export default function ScheduleDetailView({
  task,
  projects = [],
  models = [],
  modelMeta,
  onBack,                   // → setRoute('scheduled')
  onOpenRunSession,         // (sessionId) → navigate to that conversation
  onUpdate,                 // (id, payload) → server PUT
  onDelete,                 // (id) → server DELETE; should also navigate back
  onPause,                  // (id)
  onResume,                 // (id)
  onRunNow,                 // (id)
  // (task) — this page counts as reviewing an auto-pause it shows.
  onReviewedAutoPause,
  // (scheduleId) — stops the run in flight, as the chat's Stop does.
  onStopRun,
  agentLabel,
}) {
  const { t } = useTranslation('projects');
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [busy, setBusy] = useState(false);
  const toastManager = useToastManager();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const modelName = (id) => models.find((m) => m.id === id)?.name || id;

  const taskId = task?.id;
  const autoPausedAt = task?.autoPausedAt;

  useEffect(() => {
    if (task && autoPausedAt) onReviewedAutoPause?.(task);
    // Once per pause shown, not on every poll's new task object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, autoPausedAt]);

  useEffect(() => {
    if (!taskId) return;
    setLoadingRuns(true);
    fetchScheduleRuns(taskId, { limit: 100 })
      .then((data) => setRuns(Array.isArray(data?.runs) ? data.runs : []))
      .catch(() => setRuns([]))
      .finally(() => setLoadingRuns(false));
  }, [taskId, task?.lastRunAt, task?.running]);  // refresh when a run starts or reaches a terminal state

  const [showAll, setShowAll] = useState(false);
  const finished = useMemo(() => runs.filter((r) => r.status !== 'running'), [runs]);
  const succeeded = finished.filter((r) => r.status === 'success').length;

  if (!task) {
    return (
      <div className="scroll-clean flex-1 flex items-center justify-center">
        <div className="font-[family-name:var(--font-body)] text-ink-3">
          {t('scheduleDetail.notFound')}{' '}
          <button onClick={onBack} className="bg-transparent border-0 text-accent cursor-pointer">{t('scheduleDetail.backToList')}</button>
        </div>
      </div>
    );
  }

  async function withBusy(fn) {
    setBusy(true);
    try { await fn(); }
    catch (err) { toastManager.add({ type: 'danger', title: err?.message || t('scheduleDetail.actionFailed') }); }
    finally     { setBusy(false); }
  }

  const state = scheduleState(task);

  // Resolve the project name from the stored id (ENG-1255) — the schedule
  // response keys the project by id (a UUID), not a name.
  // The label, resolved by id -- named for what it holds (ENG-1676).
  const projectDisplay = projectLabel(projects.find((p) => p.id === task.projectId)) || '';

  const status = scheduleStatusBadge(task, t('scheduleStatus.lastRunFailed'));
  const sentence = scheduleSentence(task);
  const next = nextRunText(task, state);
  const shown = showAll ? runs : runs.slice(0, RUNS_SHOWN);
  const canToggle = !oneOffWithoutTime(task, state);

  return (
    <div className="scroll-clean flex-1 overflow-y-auto flex flex-col font-[family-name:var(--font-body)]">
      <PageHeader
        crumbs={[{ label: t('scheduleCommon.breadcrumb'), onClick: onBack, title: t('scheduleDetail.allScheduledTasks') }]}
        title={task.title || t('scheduleCommon.untitled')}
        subtitle={(
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-2">
            <StatusDot tone={status.variant}>{status.label}</StatusDot>
            {sentence && <><span aria-hidden className="text-ink-4">·</span><span>{sentence}</span></>}
            {next && <><span aria-hidden className="text-ink-4">·</span><span title={absoluteTime(task.nextRunAt)}>{next}</span></>}
          </div>
        )}
        actions={(
          <>
            {/* A one-off that has run, was missed, or is paused past its
                time has no time left to resume to (the server refuses):
                Run now, or Edit for a new time. */}
            {canToggle && (
              <Switch
                checked={state === 'active'}
                onCheckedChange={(on) => withBusy(async () => {
                  if (on) await onResume?.(task.id);
                  else    await onPause?.(task.id);
                })}
                disabled={busy}
                size="sm"
                aria-label={t('scheduleDetail.enabledAriaLabel')}
              />
            )}
            {/* One run at a time: while one is going, this stops it. */}
            {task.running ? (
              <Button onClick={() => withBusy(() => onStopRun?.(task.id))} disabled={busy}>
                {Ico.stop(12)}
                {busy ? t('scheduleDetail.stopping') : t('scheduleDetail.stopRun')}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => withBusy(() => onRunNow?.(task.id))} disabled={busy}>
                {Ico.send(14)}
                {busy ? t('scheduleDetail.running') : t('scheduleDetail.runNow')}
              </Button>
            )}
            {/* Edit + Delete live in the overflow — Delete opens a confirm,
                and never sits inside the edit form (ENG-1245). */}
            <OverflowMenu
              disabled={busy}
              icon={Ico.moreVert(16)}
              size="md"
              items={[
                { id: 'edit', label: t('scheduleCommon.edit'), icon: Ico.edit(14), onClick: () => setEditOpen(true) },
                { separator: true },
                { id: 'delete', label: t('scheduleCommon.delete'), icon: Ico.trash(14), danger: true, onClick: () => setConfirmDeleteOpen(true) },
              ]}
            />
          </>
        )}
      />

      <div className="px-8 pb-14 flex flex-col gap-6">
        <section className="flex flex-col gap-2" aria-label={t('scheduleDetail.scheduleAriaLabel')}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ink-3">
            <span>{projectDisplay || t('scheduleCommon.noProject')}</span>
            <span aria-hidden className="text-ink-4">·</span>
            {/* "default" is the account's configured model, not a model id. */}
            <span>{!task.model || task.model === 'default' ? t('scheduleDetail.accountDefaultModel') : modelName(task.model)}</span>
            {finished.length > 0 && (
              <>
                <span aria-hidden className="text-ink-4">·</span>
                <span>{t('scheduleDetail.succeededCount', { succeeded, total: finished.length })}</span>
              </>
            )}
          </div>
          <p className="m-0 text-[12.5px] text-ink-3">{missedRunText(task.cadence)}</p>
        </section>


        {/* How the last run went, when there is something to act on: an
            auto-pause, or a failed run, with its output to review first. */}
        <ScheduleRunAlert
          task={task}
          busy={busy}
          onResume={(id) => withBusy(() => onResume?.(id))}
          onRunNow={(id) => withBusy(() => onRunNow?.(id))}
          onReviewRun={(conversationId) => onOpenRunSession?.(conversationId)}
        />

        {task.prompt && (
          <section aria-label={t('scheduleDetail.promptAriaLabel')} className="rounded-card-row bg-surface-2 px-3.5 py-3 text-[13px] leading-[1.55] text-ink-2 whitespace-pre-wrap max-h-[168px] overflow-y-auto">
            {task.prompt}
          </section>
        )}

        <ListGroup
          title={<h2>{t('scheduleDetail.runs')}</h2>}
          meta={loadingRuns ? t('scheduleDetail.loading') : (task.runCount ?? runs.length) || null}
        >
          {runs.length === 0 && !loadingRuns && (
            <ListNotice>{t('scheduleDetail.noRuns')}</ListNotice>
          )}
          {shown.map((run) => {
            const status = RUN_STATUS[run.status] || RUN_STATUS.cancelled;
            const look = { tone: status.tone, label: t(`scheduleDetail.runStatus.${status.key}`) };
            const reason = run.status === 'failed' ? (run.error || null) : null;
            const when = absoluteTime(run.startedAt);
            return (
              <ListItem
                key={run.id || run.startedAt}
                title={absoluteTime(run.startedAt) || '—'}
                badges={run.isManual ? <Badge size="sm" variant="muted">{t('scheduleDetail.manual')}</Badge> : null}
                meta={(
                  <span className="inline-flex items-center gap-3">
                    {formatDuration(run.durationMs) && <span>{formatDuration(run.durationMs)}</span>}
                    {run.unavailableModel && (
                      <Tooltip content={`${modelName(run.unavailableModel)} isn't available, so this run used your default model.`}>
                        <span tabIndex={0} className="relative z-10 cursor-help">Default model</span>
                      </Tooltip>
                    )}
                    {reason ? (
                      // Above the row's stretched link, so the pointer reaches it.
                      <Tooltip content={reason}>
                        <span tabIndex={0} aria-label={t('scheduleDetail.statusWithReason', { status: look.label, reason })} className="relative z-10 inline-flex cursor-help rounded-sm">
                          <StatusDot tone={look.tone}>{look.label}</StatusDot>
                        </span>
                      </Tooltip>
                    ) : (
                      <StatusDot tone={look.tone}>{look.label}</StatusDot>
                    )}
                  </span>
                )}
                onActivate={run.conversationId ? () => onOpenRunSession?.(run.conversationId) : undefined}
                activateLabel={reason ? t('scheduleDetail.openFailedRun', { when, reason }) : t('scheduleDetail.openRun', { when })}
              />
            );
          })}
          {!showAll && runs.length > RUNS_SHOWN && (
            <ListNotice>
              <Button variant="subtle" size="sm" onClick={() => setShowAll(true)}>{t('scheduleDetail.showOlder')}</Button>
            </ListNotice>
          )}
        </ListGroup>
      </div>

      <ScheduleTaskModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={async (payload, id) => onUpdate?.(id, payload)}
        task={task}
        projects={projects}
        models={models}
        modelMeta={modelMeta}
        agentLabel={agentLabel}
      />

      <ConfirmModal
        open={confirmDeleteOpen}
        title={t('scheduleCommon.deleteTitle')}
        message={t('scheduleCommon.deleteMessage', { title: task.title || t('scheduleCommon.untitled') })}
        confirmLabel={t('scheduleCommon.delete')}
        cancelLabel={t('scheduleCommon.keep')}
        destructive
        busy={busy}
        busyLabel={t('scheduleCommon.deleting')}
        onConfirm={() => withBusy(async () => {
          await onDelete?.(task.id);
          // Close on success rather than relying on the host to unmount this
          // view via navigation (onDelete → setRoute); if a future onDelete
          // resolves without navigating away, the modal still dismisses and
          // can't linger over an already-deleted task.
          setConfirmDeleteOpen(false);
        })}
        onClose={() => { if (!busy) setConfirmDeleteOpen(false); }}
      />
    </div>
  );
}
