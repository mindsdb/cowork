// `<ScheduledView>` — scheduled tasks as rows, with a create modal and
// per-row actions.
//
// Click on a row → host opens the schedule detail page (set via
// onOpenSchedule prop, wired in App.jsx to setRoute('schedule-detail')).
//
// Create + edit happen in <ScheduleTaskModal>. Per-task actions (Edit,
// Pause/Resume, Delete) live in an overflow menu on each row; Delete
// opens a <ConfirmModal> here rather than deleting from inside the edit form.
//
// Run-now happens inline (no modal) — optimistic UI at the host via the
// existing onRunNow handler.

import { useMemo, useRef, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
import Ico from '../components/Icons';
import {
  PageHeader, FilterRow, SearchInput, SortPill, CollectionState,
  ListGroup, useCollectionShortcut,
} from '../components/collection';
import { Alert, Button } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import ScheduleTaskModal from '../components/schedule/ScheduleTaskModal';
import ScheduleRow from '../components/schedule/ScheduleRow';
import { lastRunFailed, scheduleState } from '../components/schedule/ScheduleStatusBadge';
import { host } from '../../platform/host';
import { STOCK_PRODUCT_NAME } from '../../../shared/product-name';

const SORT_OPTIONS = [
  { id: 'next', label: 'Next run' },
  { id: 'name', label: 'Name' },
  { id: 'created', label: 'Recently created' },
];

export default function ScheduledView({
  scheduled,
  projects,
  selectedProject,
  onCreate,
  onUpdate,
  onDelete,
  onPause,
  onResume,
  onRunNow,
  // (scheduleId) — stops the schedule's run in flight, as the chat's Stop does.
  onStopRun,
  onOpenSchedule,
  // Optional — receives the project object when a card or list row's
  // "project:" label is clicked. Wired by App.jsx to setSelected
  // Project + setRoute('projects'), the same path Live artifacts uses.
  onOpenProject,
  // Auto-paused schedules the user has not opened since they were paused
  // (useAutoPauseNotifications). Shown here until each is reviewed, so a
  // pause is not missed when its desktop notification was not.
  unseenAutoPauses = [],
  agentLabel,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Rows by default: a schedule is something you manage (status, next run,
  // run now), not a place you work in. Phones get rows too.
  // Delete confirmation is a standalone ConfirmModal (not part of the edit
  // form). `deletingTask` holds the task awaiting confirmation.
  const [deletingTask, setDeletingTask] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Total runs that slipped while the app was closed, summed across
  // all schedules. Surfaced as a small subtitle next to the total
  // count — informational only, no action required (the runner just
  // catches up to the next scheduled occurrence).
  const totalMissed = useMemo(
    () => scheduled.reduce((n, item) => n + (Number(item.missedRuns) || 0), 0),
    [scheduled]
  );

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('next');
  const searchRef = useRef(null);
  useCollectionShortcut(searchRef);

  const visible = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const matches = (item) => {
      if (!q) return true;
      // Resolve the project name from the stored id (ENG-1255) so search by
      // project works — `item.project`/`projectName` are never sent by the server.
      const proj = projects.find((p) => p.id === item.projectId);
      const haystack = [item.title, item.prompt, projectLabel(proj), proj?.name]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    };
    const filtered = scheduled.filter(matches);
    const ts = (raw) => {
      if (raw == null) return 0;
      if (typeof raw === 'number') return raw;
      const t = Date.parse(raw);
      return Number.isFinite(t) ? t : 0;
    };
    const cmp = {
      next: (a, b) => ts(a.nextRunAt) - ts(b.nextRunAt),
      name: (a, b) => (a.title || '').localeCompare(b.title || ''),
      created: (a, b) => ts(b.createdAt) - ts(a.createdAt),
    }[sort] || (() => 0);
    return [...filtered].sort(cmp);
  }, [scheduled, search, sort, projects]);

  const attentionCount = useMemo(() => visible.filter(needsAttention).length, [visible]);

  function openCreate() {
    setEditing(null);
    setError('');
    setModalOpen(true);
  }

  function openEdit(task) {
    setEditing(task);
    setError('');
    setModalOpen(true);
  }

  async function handleSubmit(payload, id, { runOnce = false } = {}) {
    if (id) {
      await onUpdate(id, payload);
      return;
    }
    const created = await onCreate(payload);
    if (runOnce && created?.id) await onRunNow(created.id);
  }

  async function confirmDelete() {
    if (!deletingTask) return;
    setDeleteBusy(true);
    setError('');
    try {
      await onDelete(deletingTask.id);
      setDeletingTask(null);
    } catch (err) {
      setError(err?.message || 'Could not delete schedule.');
    } finally {
      setDeleteBusy(false);
    }
  }

  async function runAction(id, action) {
    setBusyId(id);
    setError('');
    try { await action(id); }
    catch (err) { setError(err?.message || 'Schedule action failed.'); }
    finally { setBusyId(null); }
  }

  return (
    <div className="scroll-clean flex-1 overflow-y-auto flex flex-col">
      <PageHeader
        title="Scheduled Tasks"
        // Desktop runs its own server, so tasks stop with the app. Every web
        // build, hosted or self-hosted, runs them on a server that stays up.
        subtitle={!host.isWeb
          ? `Local scheduled ${agentLabel} tasks run while ${STOCK_PRODUCT_NAME} is open. If a run was due while the app was closed, ${agentLabel} runs the latest one when it reopens.`
          : `Scheduled ${agentLabel} tasks run on the server, even with this tab closed. If a run was due while the server was down, ${agentLabel} runs the latest one when it's back.`}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {Ico.plus(14)} Schedule task
          </Button>
        }
      />


      {scheduled.length > 0 && (
        <FilterRow
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              inputRef={searchRef}
              placeholder="Search scheduled tasks"
            />
          }
          sort={<SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
          counts={
            <>
              {(search || '').trim().length > 0
                ? `${visible.length} of ${scheduled.length} scheduled tasks`
                : `${scheduled.length} scheduled ${scheduled.length === 1 ? 'task' : 'tasks'}`}
              {totalMissed > 0 && (
                <>
                  {' · '}
                  <span className="text-ink-3">
                    {totalMissed} missed run{totalMissed === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </>
          }
        />
      )}

      {unseenAutoPauses.length > 0 && (
        <Alert
          variant="danger"
          className="mx-8 mb-3"
          title={unseenAutoPauses.length === 1
            ? `“${unseenAutoPauses[0].title || 'Untitled schedule'}” was paused after failing several runs in a row`
            : `${unseenAutoPauses.length} scheduled tasks were paused after failing several runs in a row`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {unseenAutoPauses.map((task) => (
              <Button key={task.id} size="sm" onClick={() => onOpenSchedule?.(task)}>
                {unseenAutoPauses.length === 1 ? 'Review' : `Review “${task.title || 'Untitled schedule'}”`}
              </Button>
            ))}
          </div>
        </Alert>
      )}

      {error && (
        <Alert variant="danger" className="mx-8 mb-3">{error}</Alert>
      )}

      {/* Body — empty state or list. */}
      <CollectionState
        total={scheduled.length}
        shown={visible.length}
        query={search}
        onClear={() => setSearch('')}
        empty={{
          bordered: true,
          icon: (
            <span className="inline-grid place-items-center w-[48px] h-[48px] rounded-card bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface-2))] text-accent">
              {Ico.schedule ? Ico.schedule(20) : Ico.clock(20)}
            </span>
          ),
          title: 'No scheduled tasks yet',
          description: `Create a recurring ${agentLabel} task — a Monday digest, an hourly log sweep, a daily KPI snapshot. ${agentLabel} runs them ${host.isWeb ? 'on the server, even with this tab closed' : 'while the desktop app is open'}.`,
          action: (
            <Button variant="primary" onClick={openCreate}>
              {Ico.plus(14)} Schedule your first task
            </Button>
          ),
          className: 'mx-8 my-10',
        }}
      >
        {/* What needs you sits on top: auto-paused, missed, a failed last
            run, or a retry waiting. The rest follow in the chosen order. */}
        {[
          ['attention', 'Needs attention', visible.filter(needsAttention)],
          ['rest', attentionCount ? 'Everything else' : null, visible.filter((t) => !needsAttention(t))],
        ].filter(([, , rows]) => rows.length > 0).map(([key, title, rows]) => (
          <ListGroup key={key} className="mx-8 mb-8" title={title ? <h2>{title}</h2> : undefined} meta={title ? rows.length : undefined}>
            {rows.map((task) => (
              <ScheduleRow
                key={task.id}
                task={task}
                projects={projects}
                busy={busyId === task.id}
                onOpen={() => onOpenSchedule?.(task)}
                onRunNow={() => runAction(task.id, onRunNow)}
                onStopRun={() => runAction(task.id, onStopRun)}
                onPause={() => runAction(task.id, onPause)}
                onResume={() => runAction(task.id, onResume)}
                onEdit={() => openEdit(task)}
                onDelete={() => setDeletingTask(task)}
                onOpenProject={onOpenProject}
              />
            ))}
          </ListGroup>
        ))}
      </CollectionState>

      <ScheduleTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        task={editing}
        projects={projects}
        defaultProjectPath={selectedProject?.path || ''}
        agentLabel={agentLabel}
      />

      <ConfirmModal
        open={!!deletingTask}
        title="Delete scheduled task?"
        message={deletingTask
          ? `"${deletingTask.title || 'Untitled schedule'}" will be permanently deleted. This can't be undone.`
          : ''}
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        busy={deleteBusy}
        busyLabel="Deleting…"
        onConfirm={confirmDelete}
        onClose={() => { if (!deleteBusy) setDeletingTask(null); }}
      />
    </div>
  );
}


// A task that needs the user: paused by failures, a missed one-off, a last
// run that failed, or a retry waiting.
export function needsAttention(task) {
  if (task.running) return false;
  const state = scheduleState(task);
  return state === 'auto_paused' || state === 'missed' || !!task.retryAt
    || (state === 'active' && lastRunFailed(task));
}
