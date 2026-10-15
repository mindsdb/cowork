// `<ScheduleDetailView>` — one scheduled task.
//
// Header: the page header's trail (Scheduled Tasks) above the task's name,
// with status, the schedule in words and the next run under it, and the
// task's controls beside it: the on/off switch, Run now (Stop run while one
// is going) and the overflow menu.
// Summary: project, model and how many runs succeeded.
// Runs: the collection kit's list, newest first; each row opens the run's
// conversation, and slots skipped while the app was closed show inline. A
// failed run's reason is on its status, so the same reason repeated over a
// streak of failures doesn't fill the list; the alert above says the latest
// one in full.

import { useEffect, useMemo, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
import Ico from '../components/Icons';
import { ListGroup, ListItem, ListNotice, PageHeader, StatusDot } from '../components/collection';
import { Alert, Badge, Button, Tooltip } from '../components/ui';
import { Switch } from '../components/ui/Switch';
import OverflowMenu from '../components/OverflowMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { fetchScheduleRuns } from '../api';
import ScheduleTaskModal from '../components/schedule/ScheduleTaskModal';
import { scheduleState, scheduleStatusBadge } from '../components/schedule/ScheduleStatusBadge';
import ScheduleRunAlert from '../components/schedule/ScheduleRunAlert';
import { missedRunText } from '../lib/scheduleCopy';
import { describeWhen, timeZoneLabel, whenFromDate } from '../lib/scheduleWhen';
import { relativeTime } from '../lib/formatTime';

// How many runs show before "Show older runs".
const RUNS_SHOWN = 20;

function absoluteTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
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

const RUN_STATUS = {
  running:   { tone: 'accent',  label: 'Running' },
  success:   { tone: 'success', label: 'Succeeded' },
  failed:    { tone: 'danger',  label: 'Failed' },
  cancelled: { tone: 'muted',   label: 'Stopped' },
};

// The schedule in words: "Every weekday at 9:00 AM, Los Angeles time". The
// time is shown in this computer's zone, so that is the zone it names.
function scheduleSentence(task) {
  if (!task.nextRunAt || Number.isNaN(new Date(task.nextRunAt).getTime())) return '';
  return `${describeWhen(whenFromDate(task.nextRunAt, task.cadence))}, ${timeZoneLabel()}`;
}

function nextRunText(task, state) {
  if (task.running) return 'Running now';
  // The status already says paused, missed or done.
  if (state !== 'active') return null;
  const when = relativeTime(task.nextRunAt);
  return when ? `Next run ${when}` : null;
}

function skippedText(period) {
  const count = period.slotCount;
  const runs = `${count} ${count === 1 ? 'run' : 'runs'}`;
  if (period.reason === 'one_off_missed') return 'Its time passed while MindsHub was closed.';
  const from = absoluteTime(period.firstSlot);
  const to = absoluteTime(period.lastSlot);
  const span = from && to && from !== to ? ` (${from} – ${to})` : from ? ` (${from})` : '';
  return `Skipped ${runs} while MindsHub was closed${span}. The latest one ran when it reopened.`;
}

export default function ScheduleDetailView({
  task,
  projects = [],
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
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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
          Schedule not found.{' '}
          <button onClick={onBack} className="bg-transparent border-0 text-accent cursor-pointer">Back to scheduled tasks</button>
        </div>
      </div>
    );
  }

  async function withBusy(fn) {
    setBusy(true);
    setError('');
    try { await fn(); }
    catch (err) { setError(err?.message || 'Action failed.'); }
    finally     { setBusy(false); }
  }

  const state = scheduleState(task);

  // Resolve the project name from the stored id (ENG-1255) — the schedule
  // response keys the project by id (a UUID), not a name.
  // The label, resolved by id -- named for what it holds (ENG-1676).
  const projectDisplay = projectLabel(projects.find((p) => p.id === task.projectId)) || '';

  const status = scheduleStatusBadge(task, 'Last run failed');
  const sentence = scheduleSentence(task);
  const next = nextRunText(task, state);
  const shown = showAll ? runs : runs.slice(0, RUNS_SHOWN);
  const canToggle = !(task.cadence === 'once' && ['done', 'missed'].includes(state));

  return (
    <div className="scroll-clean flex-1 overflow-y-auto flex flex-col font-[family-name:var(--font-body)]">
      <PageHeader
        crumbs={[{ label: 'Scheduled Tasks', onClick: onBack, title: 'All scheduled tasks' }]}
        title={task.title || 'Untitled schedule'}
        subtitle={(
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-2">
            <StatusDot tone={status.variant}>{status.label}</StatusDot>
            {sentence && <><span aria-hidden className="text-ink-4">·</span><span>{sentence}</span></>}
            {next && <><span aria-hidden className="text-ink-4">·</span><span title={absoluteTime(task.nextRunAt)}>{next}</span></>}
          </div>
        )}
        actions={(
          <>
            {/* A one-off that has run, or was missed, has no time left to
                resume to: Run now, or Edit for a new time. */}
            {canToggle && (
              <Switch
                checked={state === 'active'}
                onCheckedChange={(on) => withBusy(async () => {
                  if (on) await onResume?.(task.id);
                  else    await onPause?.(task.id);
                })}
                disabled={busy}
                size="sm"
                aria-label="Schedule enabled"
              />
            )}
            {/* One run at a time: while one is going, this stops it. */}
            {task.running ? (
              <Button onClick={() => withBusy(() => onStopRun?.(task.id))} disabled={busy}>
                {Ico.stop(12)}
                {busy ? 'Stopping…' : 'Stop run'}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => withBusy(() => onRunNow?.(task.id))} disabled={busy}>
                {Ico.send(14)}
                {busy ? 'Running…' : 'Run now'}
              </Button>
            )}
            {/* Edit + Delete live in the overflow — Delete opens a confirm,
                and never sits inside the edit form (ENG-1245). */}
            <OverflowMenu
              disabled={busy}
              icon={Ico.moreVert(16)}
              size="md"
              items={[
                { id: 'edit', label: 'Edit', icon: Ico.edit(14), onClick: () => setEditOpen(true) },
                { separator: true },
                { id: 'delete', label: 'Delete', icon: Ico.trash(14), danger: true, onClick: () => setConfirmDeleteOpen(true) },
              ]}
            />
          </>
        )}
      />

      <div className="px-8 pb-14 flex flex-col gap-6">
        <section className="flex flex-col gap-2" aria-label="Schedule">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ink-3">
            <span>{projectDisplay || 'No project'}</span>
            <span aria-hidden className="text-ink-4">·</span>
            {/* "default" is the account's configured model, not a model id. */}
            <span>{!task.model || task.model === 'default' ? 'Account default model' : task.model}</span>
            {finished.length > 0 && (
              <>
                <span aria-hidden className="text-ink-4">·</span>
                <span>{succeeded} of {finished.length} {finished.length === 1 ? 'run' : 'runs'} succeeded</span>
              </>
            )}
          </div>
          <p className="m-0 text-[12.5px] text-ink-3">{missedRunText(task.cadence)}</p>
        </section>

        {error && <Alert variant="danger">{error}</Alert>}

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
          <section aria-label="Prompt" className="rounded-card-row bg-surface-2 px-3.5 py-3 text-[13px] leading-[1.55] text-ink-2 whitespace-pre-wrap max-h-[168px] overflow-y-auto">
            {task.prompt}
          </section>
        )}

        <ListGroup
          title={<h2>Runs</h2>}
          meta={loadingRuns ? 'Loading…' : (task.runCount ?? runs.length) || null}
        >
          {task.lastSkipped && <ListNotice>{skippedText(task.lastSkipped)}</ListNotice>}
          {runs.length === 0 && !loadingRuns && (
            <ListNotice>No runs yet. Click Run now to try it.</ListNotice>
          )}
          {shown.map((run) => {
            const look = RUN_STATUS[run.status] || RUN_STATUS.cancelled;
            const reason = run.status === 'failed' ? (run.error || null) : null;
            const when = absoluteTime(run.startedAt);
            return (
              <ListItem
                key={run.id || run.startedAt}
                title={absoluteTime(run.startedAt) || '—'}
                badges={run.isManual ? <Badge size="sm" variant="muted">Manual</Badge> : null}
                meta={(
                  <span className="inline-flex items-center gap-3">
                    {formatDuration(run.durationMs) && <span>{formatDuration(run.durationMs)}</span>}
                    {reason ? (
                      // Above the row's stretched link, so the pointer reaches it.
                      <Tooltip content={reason}>
                        <span tabIndex={0} aria-label={`${look.label}: ${reason}`} className="relative z-10 inline-flex cursor-help rounded-sm">
                          <StatusDot tone={look.tone}>{look.label}</StatusDot>
                        </span>
                      </Tooltip>
                    ) : (
                      <StatusDot tone={look.tone}>{look.label}</StatusDot>
                    )}
                  </span>
                )}
                onActivate={run.conversationId ? () => onOpenRunSession?.(run.conversationId) : undefined}
                activateLabel={reason ? `Open the failed run from ${when}: ${reason}` : `Open the run from ${when}`}
              />
            );
          })}
          {!showAll && runs.length > RUNS_SHOWN && (
            <ListNotice>
              <Button variant="subtle" size="sm" onClick={() => setShowAll(true)}>Show older runs</Button>
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
        agentLabel={agentLabel}
      />

      <ConfirmModal
        open={confirmDeleteOpen}
        title="Delete scheduled task?"
        message={`"${task.title || 'Untitled schedule'}" will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        busy={busy}
        busyLabel="Deleting…"
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
