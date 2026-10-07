// All-tasks page. Reached via the sidebar's Recents → "View all →"
// affordance. Replaces the previous RecentsModal which capped at 100
// rows and didn't surface filtering / sorting.
//
// Rows only — there's no useful "grid" presentation for a flat list of
// conversations. Each row is a collection-kit ListItem: the title opens
// the task, meta carries the project (clickable, routes to project
// detail), a running dot, and the relative update time, and the delete
// action reveals on hover or focus. Every run of one schedule collapses
// into a single group row that opens the schedule.

import { useMemo, useRef, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
import Ico from '../components/Icons';
import { Badge, Button, Tooltip } from '../components/ui';
import { relativeAge } from '../lib/formatTime';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  FilterMenu,
  FilterChips,
  useCollectionShortcut,
  CollectionState,
  HoverActions,
  ListGroup,
  ListItem,
  StatusDot,
} from '../components/collection';

const SORT_OPTIONS = [
  { id: 'recent',  label: 'Recent' },
  { id: 'name',    label: 'Name (A–Z)' },
  { id: 'project', label: 'Project' },
];

// Project in a row's meta. Opens the project, above the row's own click
// area, when the slug resolves; plain text otherwise.
function ProjectMeta({ projectName, projects, onOpenProject }) {
  if (!projectName) return null;
  const projectMatch = projects.find((p) => p.name === projectName) || null;
  // `projectName` stays the slug -- the `p.name === projectName` match above
  // needs it, and so does the truthiness guard. This is what a person reads.
  // `projectLabel(null)` is null, so an unresolved project falls back to the
  // slug exactly as before (ENG-1676).
  const projectDisplay = projectLabel(projectMatch) || projectName;
  // The cap keeps a long name from widening the row's meta, which does not
  // shrink (it sizes to its content, even on its own phone-width line);
  // `shrink` lets the link give way inside the cap so the label truncates
  // (HoverActions is shrink-0 by default).
  return (
    <span className="flex min-w-0 max-w-[16rem] items-center gap-1.5 max-sm:max-w-[8rem]">
      <span className="inline-flex shrink-0">{Ico.folder(12)}</span>
      {projectMatch && typeof onOpenProject === 'function' ? (
        <HoverActions reveal className="min-w-0 shrink">
          <Tooltip content={`Open ${projectDisplay}`}>
            <button
              type="button"
              onClick={() => onOpenProject(projectMatch)}
              className="m-0 min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-body text-xs text-ink-3 hover:text-accent hover:underline hover:underline-offset-2"
            >{projectDisplay}</button>
          </Tooltip>
        </HoverActions>
      ) : (
        <span title={projectDisplay} className="min-w-0 truncate text-ink-3">{projectDisplay}</span>
      )}
    </span>
  );
}

// A row's meta: project, status and time. Wraps onto a second line when a
// narrow phone can't fit all three, instead of widening the page.
function RowMeta({ children }) {
  return <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{children}</span>;
}

function TaskRow({ task, projects = [], onOpen, onOpenProject, onDelete }) {
  // Prefer the same field the rest of the app uses for "last seen"
  // (updatedAt). Fall back to subtitle (legacy mock-time string)
  // when the server hasn't stamped the conversation yet.
  const updated = relativeAge(task.updatedAt || task.subtitle || task.created_at) || '—';
  return (
    <ListItem
      leading={Ico.chats(16)}
      title={task.title || 'Untitled task'}
      description={task.subtitle && task.subtitle !== updated ? task.subtitle : undefined}
      onActivate={() => onOpen?.(task)}
      meta={(
        <RowMeta>
          <ProjectMeta projectName={task.projectName || task.project || ''} projects={projects} onOpenProject={onOpenProject} />
          {task.status === 'active' && <StatusDot tone="success">Running</StatusDot>}
          <span className="whitespace-nowrap">{updated}</span>
        </RowMeta>
      )}
      actions={(
        <Tooltip content="Delete task">
          <Button variant="danger" icon size="sm" onClick={() => onDelete?.(task.id)} aria-label="Delete task">
            {Ico.trash(14)}
          </Button>
        </Tooltip>
      )}
    />
  );
}

function ScheduleGroupRow({
  schedule, runs = [], projects = [],
  onOpenSchedule, onOpenLatest, onOpenProject,
}) {
  // Latest run → drives the timestamp. Defaults to the first run when none
  // have a parsable timestamp (shouldn't happen, but guard anyway).
  const ts = (raw) => {
    if (!raw) return 0;
    if (typeof raw === 'number') return raw;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  };
  const latest = runs.reduce((max, r) =>
    ts(r.updatedAt || r.subtitle) > ts(max?.updatedAt || max?.subtitle) ? r : max,
  runs[0]);
  const updated = relativeAge(latest?.updatedAt || latest?.subtitle || schedule?.lastRunAt) || '—';

  return (
    <ListItem
      leading={Ico.schedule(16)}
      title={schedule?.title || latest?.title || 'Scheduled task'}
      badges={(
        <Badge variant="accent" size="sm" className="shrink-0 font-mono uppercase tracking-[0.06em]">
          {runs.length} {runs.length === 1 ? 'run' : 'runs'}
        </Badge>
      )}
      // The row opens the schedule (where per-run history lives); the hover
      // action jumps straight to the most recent run.
      onActivate={onOpenSchedule}
      className="bg-[color-mix(in_srgb,var(--accent)_4%,transparent)]"
      meta={(
        <RowMeta>
          <ProjectMeta
            projectName={schedule?.project || runs[0]?.projectName || runs[0]?.project || ''}
            projects={projects}
            onOpenProject={onOpenProject}
          />
          {runs.some((r) => r.status === 'active') && <StatusDot tone="success">Running</StatusDot>}
          <span className="whitespace-nowrap">{updated}</span>
        </RowMeta>
      )}
      actions={(
        <Tooltip content="Open latest run">
          <Button variant="subtle" icon size="sm" onClick={onOpenLatest} aria-label="Open latest run">
            {Ico.externalLink(14)}
          </Button>
        </Tooltip>
      )}
    />
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
  // Orphan-schedule fallback: any task or schedule run that traces
  // back to a schedule without an explicit project resolves to the
  // `general` project — matches the server's _run_schedule fallback so
  // the UI doesn't dangle scheduled tasks under a missing project.
  const ORPHAN_SCHEDULE_PROJECT = 'general';
  const rowMeta = (row) => {
    if (row.kind === 'task') {
      const explicit = row.task.projectName || row.task.project || '';
      const isScheduled = !!row.task.scheduledId;
      return {
        title:    row.task.title || '',
        project:  explicit || (isScheduled ? ORPHAN_SCHEDULE_PROJECT : ''),
        updatedAt: row.task.updatedAt || row.task.subtitle,
      };
    }
    const sched = schedulesById.get(row.scheduledId);
    const latest = row.runs.reduce((max, r) =>
      ts(r.updatedAt || r.subtitle) > ts(max?.updatedAt || max?.subtitle) ? r : max,
    row.runs[0]);
    return {
      title: sched?.title || latest?.title || 'Scheduled task',
      project: sched?.project || latest?.projectName || latest?.project || ORPHAN_SCHEDULE_PROJECT,
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
    const opts = [{ value: 'all', label: 'All projects' }];
    const seen = new Set();
    for (const p of projects) {
      if (!projectsWithTasks.has(p.name) || seen.has(p.name)) continue;
      seen.add(p.name);
      opts.push({ value: p.name, label: projectLabel(p) });
    }
    // Catch any task whose project isn't in the registered project
    // list (e.g. project was deleted but tasks linger).
    for (const n of projectsWithTasks) {
      if (seen.has(n)) continue;
      seen.add(n);
      opts.push({ value: n, label: n });
    }
    return opts;
  }, [projects, projectsWithTasks]);

  const filters = [{
    id: 'project', label: 'Project', value: projectFilter, allValue: 'all',
    options: projectFilterOptions, onChange: setProjectFilter,
  }];

  return (
    <div className="scroll-clean flex-1 overflow-y-auto flex flex-col">
      <PageHeader
        title="Tasks"
        subtitle="Every conversation across every project. Sort, filter, and jump straight in."
      />


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
          filter={<FilterMenu filters={filters} />}
          chips={<FilterChips filters={filters} onClear={() => setProjectFilter('all')} />}
          sort={<SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
          counts={
            <>
              {(search || '').trim().length > 0 || projectFilter !== 'all'
                ? `${visible.length} of ${tasks.length} tasks`
                : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
            </>
          }
        />
      )}

      <CollectionState
        total={tasks.length}
        shown={visible.length}
        query={search}
        onClear={() => { setSearch(''); setProjectFilter('all'); }}
        // Search and the project filter both narrow the list, so the copy
        // and the action cover both.
        noMatchTitle="No tasks match these filters."
        clearLabel="Clear filters"
        empty={{
          bordered: true,
          icon: <span className="inline-flex text-ink-4">{Ico.chats(32)}</span>,
          title: 'No tasks yet',
          description: 'Start a conversation from the home screen — every chat shows up here.',
          className: 'mx-8 my-10',
        }}
      >
        <ListGroup className="mx-8 mb-8">
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
        </ListGroup>
      </CollectionState>
    </div>
  );
}
