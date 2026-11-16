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
import { useToastManager } from '../components/ui/Toast';
import { ConfirmModal } from '../components/ConfirmModal';
import ScheduleTaskModal from '../components/schedule/ScheduleTaskModal';
import ScheduleRow from '../components/schedule/ScheduleRow';
import { lastRunFailed, scheduleState } from '../components/schedule/ScheduleStatusBadge';
import { host } from '../../platform/host';
import { STOCK_PRODUCT_NAME } from '../../../shared/product-name';
import { useTranslation } from '../../lib/i18n';

const SORT_IDS = ['next', 'name', 'created'];

export default function ScheduledView({
  scheduled,
  projects,
  models,
  modelMeta,
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
  const { t } = useTranslation('projects');
  const sortOptions = SORT_IDS.map((id) => ({ id, label: t(`scheduledView.sort.${id}`) }));
  const untitled = t('scheduleCommon.untitled');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const toastManager = useToastManager();
  const showError = (title) => toastManager.add({ type: 'danger', title });
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
    setModalOpen(true);
  }

  function openEdit(task) {
    setEditing(task);
    setModalOpen(true);
  }

  async function handleSubmit(payload, id, { runOnce = false } = {}) {
    if (id) {
      await onUpdate(id, payload);
      return;
    }
    const created = await onCreate(payload);
    if (!runOnce || !created?.id) return;
    // The task exists now, so a failed trial run must not fail the save: the
    // form would stay open, and saving again would create a second task.
    try {
      await onRunNow(created.id, { trial: true });
    } catch (err) {
      showError(t('scheduledView.trialRunFailed', { title: payload.title, reason: err?.message || t('scheduledView.trialRunFallback') }));
    }
  }

  async function confirmDelete() {
    if (!deletingTask) return;
    setDeleteBusy(true);
    try {
      await onDelete(deletingTask.id);
      setDeletingTask(null);
    } catch (err) {
      showError(err?.message || t('scheduledView.deleteFailed'));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function runAction(id, action) {
    setBusyId(id);
    try { await action(id); }
    catch (err) { showError(err?.message || t('scheduledView.actionFailed')); }
    finally { setBusyId(null); }
  }

  return (
    <div className="scroll-clean titlebar-fade titlebar-fade--page flex-1 overflow-y-auto flex flex-col">
      <PageHeader
        title={t('scheduledView.title')}
        // Desktop runs its own server, so tasks stop with the app. Every web
        // build, hosted or self-hosted, runs them on a server that stays up.
        subtitle={!host.isWeb
          ? t('scheduledView.subtitleDesktop', { product: STOCK_PRODUCT_NAME, agent: agentLabel })
          : t('scheduledView.subtitleWeb', { agent: agentLabel })}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {Ico.plus(14)} {t('scheduledView.scheduleTask')}
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
              placeholder={t('scheduledView.searchPlaceholder')}
            />
          }
          sort={<SortPill value={sort} onChange={setSort} options={sortOptions} />}
          counts={
            <>
              {(search || '').trim().length > 0
                ? t('scheduledView.filteredCount', { shown: visible.length, total: scheduled.length })
                : t('scheduledView.count', { count: scheduled.length })}
              {totalMissed > 0 && (
                <>
                  {' · '}
                  <span className="text-ink-3">
                    {t('scheduledView.missedCount', { count: totalMissed })}
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
            ? t('scheduledView.autoPausedOne', { title: unseenAutoPauses[0].title || untitled })
            : t('scheduledView.autoPausedMany', { count: unseenAutoPauses.length })}
        >
          <div className="flex flex-wrap items-center gap-2">
            {unseenAutoPauses.map((task) => (
              <Button key={task.id} size="sm" onClick={() => onOpenSchedule?.(task)}>
                {unseenAutoPauses.length === 1 ? t('scheduledView.review') : t('scheduledView.reviewNamed', { title: task.title || untitled })}
              </Button>
            ))}
          </div>
        </Alert>
      )}

      {/* Body — empty state or list. */}
      <CollectionState
        total={scheduled.length}
        shown={visible.length}
        query={search}
        onClear={() => setSearch('')}
        empty={{
          icon: Ico.schedule ? Ico.schedule(20) : Ico.clock(20),
          title: t('scheduledView.emptyTitle'),
          description: t('scheduledView.emptyDescription', { agent: agentLabel }),
          action: { label: t('scheduledView.emptyAction'), onClick: openCreate },
          className: 'mx-8 mb-8',
        }}
      >
        {/* What needs you sits on top: auto-paused, missed, or a failed last
            run. The rest follow in the chosen order. */}
        {[
          ['attention', t('scheduledView.needsAttention'), visible.filter(needsAttention)],
          ['rest', attentionCount ? t('scheduledView.everythingElse') : null, visible.filter((t) => !needsAttention(t))],
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
        models={models}
        modelMeta={modelMeta}
        defaultProjectPath={selectedProject?.path || ''}
        agentLabel={agentLabel}
      />

      <ConfirmModal
        open={!!deletingTask}
        title={t('scheduleCommon.deleteTitle')}
        message={deletingTask
          ? t('scheduleCommon.deleteMessage', { title: deletingTask.title || untitled })
          : ''}
        confirmLabel={t('scheduleCommon.delete')}
        cancelLabel={t('scheduleCommon.keep')}
        destructive
        busy={deleteBusy}
        busyLabel={t('scheduleCommon.deleting')}
        onConfirm={confirmDelete}
        onClose={() => { if (!deleteBusy) setDeletingTask(null); }}
      />
    </div>
  );
}


// A task that needs the user: paused by failures, a missed one-off, or a last
// run that failed.
export function needsAttention(task) {
  if (task.running) return false;
  const state = scheduleState(task);
  return state === 'auto_paused' || state === 'missed'
    || (state === 'active' && lastRunFailed(task));
}
