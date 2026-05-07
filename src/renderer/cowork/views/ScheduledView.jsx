// `<ScheduledView>` — list of scheduled tasks with grid/list view
// toggle + create modal + per-card hover actions.
//
// Click on a card → host opens the schedule detail page (set via
// onOpenSchedule prop, wired in App.jsx to setRoute('schedule-detail')).
//
// Create + edit happen in <ScheduleTaskModal>; delete is handled
// inside the edit modal as a confirm flow.
//
// Run-now / Pause / Resume happen inline (no modal) — optimistic UI
// at the host via the existing onPause/onResume/onRunNow handlers.

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import {
  PageHeader, FilterRow, SearchInput, SortPill,
  ViewToggle,
  useCollectionShortcut,
} from '../components/collection';
import ScheduleTaskModal from '../components/schedule/ScheduleTaskModal';
import ScheduleCard from '../components/schedule/ScheduleCard';

const FONT_BODY = 'var(--font-body)';

const SORT_OPTIONS = [
  { id: 'next',    label: 'Next run' },
  { id: 'name',    label: 'Name' },
  { id: 'created', label: 'Recently created' },
];

// Match the storage-key convention used by ArtifactsView /
// ProjectsView (`anton:<surface>-view`). Same value-shape too —
// 'grid' | 'list'.
const VIEW_MODE_KEY = 'anton:scheduled-view';

function loadViewMode() {
  if (typeof localStorage === 'undefined') return 'grid';
  const v = localStorage.getItem(VIEW_MODE_KEY);
  return v === 'list' ? 'list' : 'grid';
}

function saveViewMode(mode) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch {}
}


export default function ScheduledView({
  scheduled,
  projects,
  models,
  selectedProject,
  selectedModel,
  onCreate,
  onUpdate,
  onDelete,
  onPause,
  onResume,
  onRunNow,
  onOpenSchedule,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState(loadViewMode);

  // Persist the view-mode choice — same toggle should still feel set
  // when the user comes back to this surface tomorrow.
  useEffect(() => { saveViewMode(viewMode); }, [viewMode]);

  const pendingCatchup = useMemo(
    () => scheduled.filter((item) => item.catchupPending),
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
      const haystack = [item.title, item.prompt, item.projectPath]
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
      next:    (a, b) => ts(a.nextRunAt) - ts(b.nextRunAt),
      name:    (a, b) => (a.title || '').localeCompare(b.title || ''),
      created: (a, b) => ts(b.createdAt) - ts(a.createdAt),
    }[sort] || (() => 0);
    return [...filtered].sort(cmp);
  }, [scheduled, search, sort]);

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

  async function handleSubmit(payload, id) {
    if (id) await onUpdate(id, payload);
    else    await onCreate(payload);
  }

  async function handleDelete(id) {
    await onDelete(id);
  }

  async function runAction(id, action) {
    setBusyId(id);
    setError('');
    try { await action(id); }
    catch (err) { setError(err?.message || 'Schedule action failed.'); }
    finally     { setBusyId(null); }
  }

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Scheduled tasks"
        subtitle="Local scheduled Anton tasks run while Anton CoWork is open. Missed runs wait for approval."
        actions={
          <button className="btn-primary" onClick={openCreate}>
            {Ico.plus(14)} Schedule task
          </button>
        }
      />

      <div style={{ height: 18 }} />

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
          view={<ViewToggle value={viewMode} onChange={setViewMode} />}
          counts={
            <>
              {(search || '').trim().length > 0
                ? `Showing ${visible.length} of ${scheduled.length}`
                : `${scheduled.length} scheduled ${scheduled.length === 1 ? 'task' : 'tasks'}`}
              {pendingCatchup.length > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--accent)' }}>
                    {pendingCatchup.length} need{pendingCatchup.length === 1 ? 's' : ''} approval
                  </span>
                </>
              )}
            </>
          }
        />
      )}

      {pendingCatchup.length > 0 && (
        <div className="catchup-banner">
          <span>{Ico.clock(16)}</span>
          <div>
            <strong>{pendingCatchup.length} missed scheduled run{pendingCatchup.length === 1 ? '' : 's'} need approval</strong>
            <p>Run each one manually from the list when you are ready.</p>
          </div>
        </div>
      )}

      {error && (
        <div style={{
          margin: '0 28px 12px', padding: '8px 10px', borderRadius: 7,
          background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
          color: 'var(--danger)', fontSize: 12.5,
        }}>{error}</div>
      )}

      {/* Body — empty state, grid, or list. */}
      {!scheduled.length ? (
        <EmptyState onCreate={openCreate} />
      ) : viewMode === 'grid' ? (
        <div style={{
          padding: '8px 28px 28px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}>
          {visible.map((task) => (
            <ScheduleCard
              key={task.id}
              task={task}
              busy={busyId === task.id}
              onOpen={() => onOpenSchedule?.(task)}
              onRunNow={() => runAction(task.id, onRunNow)}
              onPause={()  => runAction(task.id, onPause)}
              onResume={() => runAction(task.id, onResume)}
              onEdit={()   => openEdit(task)}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: '8px 28px 28px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map((task) => (
            <ScheduleListRow
              key={task.id}
              task={task}
              busy={busyId === task.id}
              onOpen={() => onOpenSchedule?.(task)}
              onRunNow={() => runAction(task.id, onRunNow)}
              onPause={()  => runAction(task.id, onPause)}
              onResume={() => runAction(task.id, onResume)}
              onEdit={()   => openEdit(task)}
            />
          ))}
        </div>
      )}

      <ScheduleTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        task={editing}
        projects={projects}
        models={models}
        defaultProjectPath={selectedProject?.path || ''}
        defaultModelId={selectedModel?.id || ''}
      />
    </div>
  );
}


// ── List row ──
//
// Same data + handlers as the card, laid out as a single horizontal
// row. Used when the user wants density over visuals.

function ScheduleListRow({ task, busy, onOpen, onRunNow, onPause, onResume, onEdit }) {
  const [hover, setHover] = useState(false);
  const open = () => onOpen?.(task);
  const stop = (e) => { e.stopPropagation(); };

  const status = (() => {
    if (task.catchupPending) return { label: 'Catch up', dot: 'var(--accent)' };
    if (!task.enabled)       return { label: 'Paused',   dot: 'var(--ink-4)' };
    if (task.lastError)      return { label: 'Failed',   dot: 'var(--danger)' };
    return { label: 'Active', dot: 'var(--success)' };
  })();

  const cadenceLabel = {
    once: 'Once', hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly',
  }[task.cadence] || task.cadence;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '14px minmax(0, 2.4fr) 80px 1.4fr 1.2fr auto',
        alignItems: 'center', gap: 14,
        padding: '10px 14px',
        background: hover ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${hover ? 'var(--accent)' : 'var(--line)'}`,
        borderRadius: 10,
        cursor: 'pointer',
        font: 'inherit', color: 'inherit', textAlign: 'left',
        outline: 'none',
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <span aria-hidden style={{
        width: 10, height: 10, borderRadius: '50%',
        background: status.dot,
      }} title={status.label} />

      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 13.5, fontWeight: 600,
          color: 'var(--ink)', letterSpacing: '-0.005em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{task.title || 'Untitled schedule'}</div>
        {task.prompt && (
          <div style={{
            fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginTop: 2,
          }}>{task.prompt}</div>
        )}
      </div>

      <div style={{
        fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-2)',
      }}>{cadenceLabel}</div>

      <div style={{
        fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-2)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        Next · {formatAbsolute(task.nextRunAt)}
      </div>

      <div style={{
        fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {task.lastRunAt ? `Last · ${formatAbsolute(task.lastRunAt)}` : '—'}
      </div>

      <div onClick={stop} onMouseDown={stop}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          opacity: hover ? 1 : 0,
          transition: 'opacity 140ms ease',
          pointerEvents: hover ? 'auto' : 'none',
        }}
      >
        <RowAction icon={Ico.send(12)} label="Run" onClick={onRunNow} busy={busy} />
        {task.enabled
          ? <RowAction icon={Ico.stop(12)}  label="Pause"  onClick={onPause}  busy={busy} />
          : <RowAction icon={Ico.power(12)} label="Resume" onClick={onResume} busy={busy} />}
        <RowAction icon={Ico.edit(12)} label="Edit" onClick={onEdit} busy={busy} />
      </div>
    </div>
  );
}

function formatAbsolute(iso) {
  if (!iso) return 'not set';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'not set';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function RowAction({ icon, label, onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 8px', borderRadius: 6,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        color: 'var(--ink-2)',
        fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 500,
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >{icon}{label}</button>
  );
}


// ── Empty state ──

function EmptyState({ onCreate }) {
  return (
    <div style={{
      margin: '40px 28px',
      padding: '40px 28px',
      borderRadius: 14,
      border: '1px dashed var(--line-2)',
      background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      gap: 12,
    }}>
      <span style={{
        display: 'inline-grid', placeItems: 'center',
        width: 48, height: 48, borderRadius: 12,
        background: 'color-mix(in srgb, var(--accent) 12%, var(--surface-2))',
        color: 'var(--accent)',
      }}>
        {Ico.schedule ? Ico.schedule(20) : Ico.clock(20)}
      </span>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600,
        color: 'var(--ink)',
      }}>No scheduled tasks yet</div>
      <div style={{
        fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-3)',
        maxWidth: 360, lineHeight: 1.5,
      }}>
        Create a recurring Anton task — a Monday digest, an hourly log
        sweep, a daily KPI snapshot. Anton runs them while the desktop
        app is open.
      </div>
      <button
        className="btn-primary"
        onClick={onCreate}
        style={{ marginTop: 4 }}
      >
        {Ico.plus(14)} Schedule your first task
      </button>
    </div>
  );
}
