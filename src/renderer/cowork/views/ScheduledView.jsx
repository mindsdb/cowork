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
  // Optional — receives the project object when a card or list row's
  // "project:" label is clicked. Wired by App.jsx to setSelected
  // Project + setRoute('projects'), the same path Live artifacts uses.
  onOpenProject,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState(loadViewMode);

  // Persist the view-mode choice — same toggle should still feel set
  // when the user comes back to this surface tomorrow.
  useEffect(() => { saveViewMode(viewMode); }, [viewMode]);

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
        title="Scheduled Tasks"
        subtitle="Local scheduled Anton tasks run while Anton CoWork is open. Runs that slip while the app is closed are skipped — Anton resumes from the next scheduled occurrence."
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
              {totalMissed > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--ink-3)' }}>
                    {totalMissed} missed run{totalMissed === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </>
          }
        />
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
              projects={projects}
              busy={busyId === task.id}
              onOpen={() => onOpenSchedule?.(task)}
              onRunNow={() => runAction(task.id, onRunNow)}
              onPause={()  => runAction(task.id, onPause)}
              onResume={() => runAction(task.id, onResume)}
              onEdit={()   => openEdit(task)}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: '8px 28px 28px' }}>
          <ListHeaderRow />
          {visible.map((task) => (
            <ScheduleListRow
              key={task.id}
              task={task}
              projects={projects}
              busy={busyId === task.id}
              onOpen={() => onOpenSchedule?.(task)}
              onRunNow={() => runAction(task.id, onRunNow)}
              onPause={()  => runAction(task.id, onPause)}
              onResume={() => runAction(task.id, onResume)}
              onEdit={()   => openEdit(task)}
              onOpenProject={onOpenProject}
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


// ── List view ──
//
// Slick table that mirrors the rhythm used by Live Artifacts and
// Projects: monospaced uppercase header, tight bordered rows, hover
// reveals row-level actions in the right meta slot. Columns:
//   • status dot
//   • Title (with prompt subtitle)
//   • Cadence
//   • Project (clickable when resolved)
//   • Next run
//   • Last run
//   • action menu (hover-revealed)

const FONT_DISPLAY = 'var(--font-display)';
const FONT_MONO    = 'var(--font-mono)';

// 24px dot · 2.2fr title · 90px cadence · 1.1fr project · 130px next ·
// 110px last · fixed-width actions slot.
//
// The action column needs a *fixed* width because each row is its
// own CSS-grid, not a child of one shared grid — `auto` would size
// the header's empty slot to 0 while the rows' slot would size to
// the inline action buttons (~190px), throwing the columns off by
// the difference. Width is chosen to fit Run + Pause/Resume + Edit
// without wrapping.
const LIST_GRID = '24px minmax(0, 2.2fr) 90px minmax(0, 1.1fr) 130px 110px 190px';

function ListHeaderRow() {
  const Cell = ({ children, align }) => (
    <div style={{
      fontFamily: FONT_MONO, fontSize: 10.5,
      color: 'var(--ink-4)', letterSpacing: '0.10em',
      textTransform: 'uppercase',
      textAlign: align || 'left',
    }}>{children}</div>
  );
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
      padding: '10px 14px',
      borderBottom: '1px solid var(--line)',
    }}>
      <Cell />
      <Cell>Title</Cell>
      <Cell>Cadence</Cell>
      <Cell>Project</Cell>
      <Cell>Next run</Cell>
      <Cell>Last run</Cell>
      <Cell />
    </div>
  );
}

function ScheduleListRow({
  task, busy, projects = [], onOpen,
  onRunNow, onPause, onResume, onEdit, onOpenProject,
}) {
  const [hover, setHover] = useState(false);
  const open = () => onOpen?.(task);
  const stop = (e) => { e.stopPropagation(); };

  const status = (() => {
    if (!task.enabled)       return { label: 'Paused',   dot: 'var(--ink-4)' };
    if (task.lastError)      return { label: 'Failed',   dot: 'var(--danger)' };
    return { label: 'Active', dot: 'var(--success)' };
  })();
  const missedRuns = Number(task.missedRuns) || 0;

  const cadenceLabel = {
    once: 'Once', hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly',
  }[task.cadence] || task.cadence;

  const projectName = task.project || task.projectName || '';
  const projectMatch = projectName
    ? projects.find((p) => p.name === projectName) || null
    : null;
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
        padding: '12px 14px',
        background: hover ? 'var(--surface)' : 'transparent',
        borderBottom: '1px solid var(--line)',
        cursor: 'pointer',
        transition: 'background .12s ease',
        alignItems: 'center',
        outline: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span aria-hidden title={status.label} style={{
          width: 8, height: 8, borderRadius: 99,
          background: status.dot,
          boxShadow: status.dot === 'var(--success)'
            ? '0 0 6px var(--success-glow)'
            : 'none',
        }} />
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          minWidth: 0,
        }}>
          <span style={{
            fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600,
            color: 'var(--ink)', letterSpacing: '-0.005em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{task.title || 'Untitled schedule'}</span>
          {/* Missed-runs annotation — shows alongside the title so the
              user sees how many cadence ticks were skipped while the
              app was off. Cleared on the next successful run. */}
          {missedRuns > 0 && (
            <span style={{
              fontFamily: FONT_MONO, fontSize: 10.5,
              color: 'var(--ink-4)', letterSpacing: '0.04em',
              flexShrink: 0,
            }}>
              missed {missedRuns}
            </span>
          )}
        </div>
        {task.prompt && (
          <div style={{
            fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginTop: 2,
          }}>{task.prompt}</div>
        )}
      </div>

      <div style={{
        fontFamily: FONT_MONO, fontSize: 11,
        color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>{cadenceLabel}</div>

      <div style={{
        fontFamily: FONT_BODY, fontSize: 12.5,
        color: 'var(--ink-2)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        minWidth: 0,
      }}>
        {projectName ? (
          canOpenProject ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              title={`Open ${projectMatch.name}`}
              style={{
                all: 'unset', cursor: 'pointer',
                color: 'var(--ink-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: '100%', display: 'inline-block',
                transition: 'color 120ms ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
                e.currentTarget.style.textDecoration = 'underline';
                e.currentTarget.style.textUnderlineOffset = '2px';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = 'var(--ink-2)';
                e.currentTarget.style.textDecoration = 'none';
              }}
            >{projectName}</button>
          ) : projectName
        ) : <span style={{ color: 'var(--ink-5)' }}>—</span>}
      </div>

      <div title={absoluteFull(task.nextRunAt)} style={{
        fontFamily: FONT_MONO, fontSize: 11,
        color: 'var(--ink-3)', letterSpacing: '0.04em',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{task.enabled ? formatAbsolute(task.nextRunAt) : 'Paused'}</div>

      <div title={task.lastRunAt ? absoluteFull(task.lastRunAt) : ''} style={{
        fontFamily: FONT_MONO, fontSize: 11,
        color: 'var(--ink-4)', letterSpacing: '0.04em',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{task.lastRunAt ? formatAbsolute(task.lastRunAt) : '—'}</div>

      <div onClick={stop} onMouseDown={stop}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          justifyContent: 'flex-end',
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

function absoluteFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
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
