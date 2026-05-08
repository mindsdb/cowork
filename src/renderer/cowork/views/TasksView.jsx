// All-tasks page. Reached via the sidebar's Recents → "View all →"
// affordance. Replaces the previous RecentsModal which capped at 100
// rows and didn't surface filtering / sorting. Mirrors the slick-
// table rhythm we use on Projects, Live Artifacts, and Scheduled
// (status dot · primary text · per-row meta · hover-only kebab).
//
// List view only — there's no useful "grid" presentation for a flat
// list of conversations.
//
// Columns (left to right):
//   • dot       — green pulse when task is currently streaming.
//   • Title     — task title (clickable; whole row routes to chat).
//   • Project   — project name; clickable, routes to project detail.
//   • Updated   — relative timestamp (mono).
//   • trash     — appears on row hover, opens the existing delete
//                 confirm modal via the parent's onDeleteTask.

import { useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  useCollectionShortcut,
} from '../components/collection';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';
const FONT_MONO    = 'var(--font-mono)';

const SORT_OPTIONS = [
  { id: 'recent',  label: 'Recent' },
  { id: 'name',    label: 'Name (A–Z)' },
  { id: 'project', label: 'Project' },
];

// 24px dot · title (2.4fr) · project (1.2fr) · updated (110px) ·
// trash slot (28px). Fixed-width slots stop the column stops from
// shifting between hover/non-hover so the trash icon doesn't
// shove the timestamp left when it appears.
const LIST_GRID = '24px minmax(0, 2.4fr) minmax(0, 1.2fr) 110px 28px';

function relAge(input) {
  if (!input) return '—';
  const ts = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ts)) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000)         return 'just now';
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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
      <Cell>Project</Cell>
      <Cell>Updated</Cell>
      <Cell />
    </div>
  );
}

function TaskRow({
  task, projects = [],
  onOpen,
  onOpenProject,
  onDelete,
}) {
  const [hover, setHover] = useState(false);
  const stop = (e) => { e.stopPropagation(); };

  const projectName = task.projectName || task.project || '';
  const projectMatch = projectName
    ? projects.find((p) => p.name === projectName) || null
    : null;
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  const isActive = task.status === 'active';
  const dotColor = isActive ? 'var(--success)' : 'var(--ink-5)';

  // Prefer the same field the rest of the app uses for "last seen"
  // (updatedAt). Fall back to subtitle (legacy mock-time string)
  // when the server hasn't stamped the conversation yet.
  const updated = relAge(task.updatedAt || task.subtitle || task.created_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(task)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(task); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
        padding: '12px 14px',
        background: hover ? 'var(--surface)' : 'transparent',
        cursor: 'pointer',
        transition: 'background .12s ease',
        alignItems: 'center',
        outline: 'none',
        borderRadius: 8,
      }}
    >
      {/* Status dot */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span
          aria-hidden
          className={isActive ? 'pulse-dot' : undefined}
          title={isActive ? 'Running' : ''}
          style={{
            width: 8, height: 8, borderRadius: 99,
            background: dotColor,
            boxShadow: isActive ? '0 0 6px var(--success-glow)' : 'none',
          }}
        />
      </div>

      {/* Title (+ optional preview as quiet sub-line) */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600,
          color: 'var(--ink)', letterSpacing: '-0.005em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{task.title || 'Untitled task'}</div>
        {task.subtitle && task.subtitle !== updated && (
          <div style={{
            fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginTop: 2,
          }}>{task.subtitle}</div>
        )}
      </div>

      {/* Project — clickable when resolved */}
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

      {/* Updated */}
      <div style={{
        fontFamily: FONT_MONO, fontSize: 11,
        color: 'var(--ink-4)', letterSpacing: '0.04em',
      }}>{updated}</div>

      {/* Hover-revealed trash. Fixed slot width keeps the Updated
          column stable; opacity + pointer-events flip on hover so
          the icon never participates in click bubbling at rest. */}
      <div onClick={stop} onMouseDown={stop} style={{
        display: 'flex', justifyContent: 'flex-end',
        opacity: hover ? 1 : 0,
        transition: 'opacity 140ms ease',
        pointerEvents: hover ? 'auto' : 'none',
      }}>
        <button
          type="button"
          onClick={() => onDelete?.(task.id)}
          aria-label="Delete task"
          title="Delete task"
          className="icon-btn"
          style={{
            width: 26, height: 26, borderRadius: 6,
            color: 'var(--ink-3)',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--danger) 12%, transparent)';
            e.currentTarget.style.color = 'var(--danger)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--ink-3)';
          }}
        >
          {Ico.trash(14)}
        </button>
      </div>
    </div>
  );
}

function ScheduleGroupRow({
  schedule, runs = [], projects = [],
  onOpenSchedule, onOpenLatest, onOpenProject,
}) {
  const [hover, setHover] = useState(false);
  const stop = (e) => { e.stopPropagation(); };

  const projectName = schedule?.project || runs[0]?.projectName || runs[0]?.project || '';
  const projectMatch = projectName
    ? projects.find((p) => p.name === projectName) || null
    : null;
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  // Latest run → drives the timestamp + the "open the actual chat"
  // affordance. Defaults to the first run when none have a parsable
  // timestamp (shouldn't happen, but guard anyway).
  const ts = (raw) => {
    if (!raw) return 0;
    if (typeof raw === 'number') return raw;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  };
  const latest = runs.reduce((max, r) =>
    ts(r.updatedAt || r.subtitle) > ts(max?.updatedAt || max?.subtitle) ? r : max,
  runs[0]);
  const updated = relAge(latest?.updatedAt || latest?.subtitle || schedule?.lastRunAt);

  const isAnyActive = runs.some((r) => r.status === 'active');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenSchedule}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSchedule?.(); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
        padding: '12px 14px',
        // Group rows get a slightly tinted bg so they read as a
        // distinct unit from the lone-task rows around them.
        background: hover
          ? 'var(--surface)'
          : 'color-mix(in srgb, var(--accent) 4%, transparent)',
        cursor: 'pointer',
        transition: 'background .12s ease',
        alignItems: 'center',
        outline: 'none',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span aria-hidden title="Scheduled task" style={{
          width: 8, height: 8, borderRadius: 99,
          background: isAnyActive ? 'var(--success)' : 'var(--accent)',
          boxShadow: isAnyActive ? '0 0 6px var(--success-glow)' : '0 0 6px var(--accent-glow)',
        }} className={isAnyActive ? 'pulse-dot' : undefined} />
      </div>

      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600,
          color: 'var(--ink)', letterSpacing: '-0.005em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          minWidth: 0,
        }}>{schedule?.title || latest?.title || 'Scheduled task'}</span>
        <span style={{
          fontFamily: FONT_MONO, fontSize: 10.5,
          color: 'var(--accent)', letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 999,
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
          flexShrink: 0,
        }}>
          {runs.length} {runs.length === 1 ? 'run' : 'runs'}
        </span>
      </div>

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

      <div style={{
        fontFamily: FONT_MONO, fontSize: 11,
        color: 'var(--ink-4)', letterSpacing: '0.04em',
      }}>{updated}</div>

      {/* Action slot — hover-revealed "Open latest" so the user can
          jump straight to the most recent run instead of going
          through schedule detail. The card click itself routes to
          the schedule view (where per-run history lives). */}
      <div onClick={stop} onMouseDown={stop} style={{
        display: 'flex', justifyContent: 'flex-end',
        opacity: hover ? 1 : 0,
        transition: 'opacity 140ms ease',
        pointerEvents: hover ? 'auto' : 'none',
      }}>
        <button
          type="button"
          onClick={onOpenLatest}
          aria-label="Open latest run"
          title="Open latest run"
          className="icon-btn"
          style={{
            width: 26, height: 26, borderRadius: 6,
            color: 'var(--ink-3)',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'var(--surface-2)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--ink-3)';
          }}
        >
          {Ico.externalLink(13)}
        </button>
      </div>
    </div>
  );
}

export default function TasksView({
  tasks = [],
  projects = [],
  // Schedules + flat sessionId→scheduleId index. When a task carries
  // a `scheduledId` (or its id is keyed in the index), we collapse
  // every run of that schedule into a single grouped row showing
  // "Schedule: <title> · N runs". Click → open the latest run.
  schedules = [],
  scheduleRunsIndex = {},
  onOpenTask,
  onOpenProject,
  onOpenSchedule,
  onDeleteTask,
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [projectFilter, setProjectFilter] = useState('all');
  const searchRef = useRef(null);
  useCollectionShortcut(searchRef);

  // First pass: collapse all runs of a single schedule into one
  // synthetic group row. Without this the page reads as a wall of
  // duplicate "Daily digest" entries — one per execution — which
  // makes scanning impossible. The group row's title comes from
  // the schedule itself; meta carries the most recent run's
  // timestamp + a "N runs" tag. Click the group row → routes to
  // the schedule's detail page (where the per-run history already
  // lives) instead of opening one specific run.
  const schedulesById = useMemo(() => {
    const out = new Map();
    for (const s of schedules || []) {
      if (s && s.id) out.set(s.id, s);
    }
    return out;
  }, [schedules]);

  // Augment each task with its scheduled id (from server-side
  // scheduledId OR the index lookup as a fallback for older
  // records that were saved before the field was plumbed).
  const augmented = useMemo(() => (
    (tasks || []).map((t) => {
      const sid = t.scheduledId || scheduleRunsIndex[t.id] || null;
      return sid ? { ...t, scheduledId: sid } : t;
    })
  ), [tasks, scheduleRunsIndex]);

  // Group: any task with a scheduledId rolls into one row keyed on
  // that id. Non-scheduled tasks pass through 1:1.
  const grouped = useMemo(() => {
    const out = [];
    const groupsBySchedId = new Map();
    for (const t of augmented) {
      if (!t.scheduledId) {
        out.push({ kind: 'task', task: t });
        continue;
      }
      let g = groupsBySchedId.get(t.scheduledId);
      if (!g) {
        g = { kind: 'group', scheduledId: t.scheduledId, runs: [] };
        groupsBySchedId.set(t.scheduledId, g);
        out.push(g);
      }
      g.runs.push(t);
    }
    return out;
  }, [augmented]);

  const ts = (raw) => {
    if (!raw) return 0;
    if (typeof raw === 'number') return raw;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  };

  // Compute a row-shape representative for filtering / sorting that
  // works for both lone tasks AND collapsed schedule groups.
  // Group rows expose:
  //   title:     the schedule's own title (falls back to the latest
  //              run's title if the schedule isn't in the registry)
  //   project:   the schedule's project (or the runs' shared project)
  //   updatedAt: max(updatedAt across all runs)
  const rowMeta = (row) => {
    if (row.kind === 'task') {
      return {
        title:    row.task.title || '',
        project:  row.task.projectName || row.task.project || '',
        updatedAt: row.task.updatedAt || row.task.subtitle,
      };
    }
    const sched = schedulesById.get(row.scheduledId);
    const latest = row.runs.reduce((max, r) =>
      ts(r.updatedAt || r.subtitle) > ts(max?.updatedAt || max?.subtitle) ? r : max,
    row.runs[0]);
    return {
      title: sched?.title || latest?.title || 'Scheduled task',
      project: sched?.project || latest?.projectName || latest?.project || '',
      updatedAt: latest?.updatedAt || latest?.subtitle || sched?.lastRunAt,
    };
  };

  const visible = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const matches = (row) => {
      const meta = rowMeta(row);
      const haystack = [meta.title, meta.project].filter(Boolean).join(' ').toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (projectFilter !== 'all' && meta.project !== projectFilter) return false;
      return true;
    };
    const filtered = grouped.filter(matches);
    const cmp = {
      recent:  (a, b) => ts(rowMeta(b).updatedAt) - ts(rowMeta(a).updatedAt),
      name:    (a, b) => rowMeta(a).title.localeCompare(rowMeta(b).title),
      project: (a, b) => {
        const pa = rowMeta(a).project.toLowerCase();
        const pb = rowMeta(b).project.toLowerCase();
        if (pa !== pb) return pa.localeCompare(pb);
        return ts(rowMeta(b).updatedAt) - ts(rowMeta(a).updatedAt);
      },
    }[sort] || (() => 0);
    return [...filtered].sort(cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, search, sort, projectFilter, schedulesById]);

  // Project filter dropdown options. "All projects" + every project
  // present in the projects list, sorted by name. We only show
  // projects that actually have at least one task to keep the
  // filter compact — tracked via a Set built from the live tasks.
  const projectsWithTasks = useMemo(() => {
    const set = new Set();
    for (const t of tasks) {
      const n = t.projectName || t.project;
      if (n) set.add(n);
    }
    return set;
  }, [tasks]);
  const projectFilterOptions = useMemo(() => {
    const opts = [{ id: 'all', label: 'All projects' }];
    const seen = new Set();
    for (const p of projects) {
      if (!projectsWithTasks.has(p.name) || seen.has(p.name)) continue;
      seen.add(p.name);
      opts.push({ id: p.name, label: p.name });
    }
    // Catch any task whose project isn't in the registered project
    // list (e.g. project was deleted but tasks linger).
    for (const n of projectsWithTasks) {
      if (seen.has(n)) continue;
      seen.add(n);
      opts.push({ id: n, label: n });
    }
    return opts;
  }, [projects, projectsWithTasks]);

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Tasks"
        subtitle="Every conversation across every project. Sort, filter, and jump straight in."
      />

      {/* Subtitle → search spacer. 32px (was 18) gives the search
          bar room to breathe under the subtitle on this view. */}
      <div style={{ height: 32 }} />

      {tasks.length > 0 && (
        <FilterRow
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              inputRef={searchRef}
              placeholder="Search tasks"
            />
          }
          sort={
            <>
              <SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />
              <SortPill
                value={projectFilter}
                onChange={setProjectFilter}
                options={projectFilterOptions}
                label="Project"
              />
            </>
          }
          counts={
            <>
              {(search || '').trim().length > 0 || projectFilter !== 'all'
                ? `Showing ${visible.length} of ${tasks.length}`
                : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
            </>
          }
        />
      )}

      {tasks.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ padding: '8px 28px 28px' }}>
          <ListHeaderRow />
          {visible.map((row) => {
            if (row.kind === 'task') {
              return (
                <TaskRow
                  key={row.task.id}
                  task={row.task}
                  projects={projects}
                  onOpen={(task) => onOpenTask?.(task.id)}
                  onOpenProject={onOpenProject}
                  onDelete={(id) => onDeleteTask?.(id)}
                />
              );
            }
            const sched = schedulesById.get(row.scheduledId);
            return (
              <ScheduleGroupRow
                key={`sched:${row.scheduledId}`}
                schedule={sched}
                runs={row.runs}
                projects={projects}
                onOpenSchedule={() => onOpenSchedule?.(row.scheduledId)}
                onOpenLatest={() => {
                  const latest = row.runs.reduce((max, r) =>
                    ts(r.updatedAt || r.subtitle) > ts(max?.updatedAt || max?.subtitle) ? r : max,
                  row.runs[0]);
                  if (latest?.id) onOpenTask?.(latest.id);
                }}
                onOpenProject={onOpenProject}
              />
            );
          })}
          {visible.length === 0 && (
            <div style={{
              padding: '40px 14px',
              fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-4)',
              textAlign: 'center',
            }}>
              No tasks match these filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      margin: '40px 28px', padding: '40px 28px',
      borderRadius: 14,
      border: '1px dashed var(--line-2)',
      background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      gap: 10,
    }}>
      <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>{Ico.chats(28)}</span>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
        No tasks yet
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-3)', maxWidth: 320 }}>
        Start a conversation from the home screen — every chat shows up here.
      </div>
    </div>
  );
}
