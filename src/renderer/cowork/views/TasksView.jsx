// All-tasks page. Reached via the sidebar's Recents → "View all →"
// affordance. Replaces the previous RecentsModal which capped at 100
// rows and didn't surface filtering / sorting.
//
// Rows only, the shared TaskRow (components/task). Every run of one schedule
// collapses into a single group row that opens the schedule.

import { useMemo, useRef, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
import Ico from '../components/Icons';
import { TaskRow, ScheduleGroupRow, chatTaskMenu, chatTaskRow, groupScheduleRuns, latestRun, ts } from '../components/task';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  FilterMenu,
  FilterChips,
  useCollectionShortcut,
  CollectionState,
  ListGroup,
} from '../components/collection';

const SORT_OPTIONS = [
  { id: 'recent',  label: 'Recent' },
  { id: 'name',    label: 'Name (A–Z)' },
  { id: 'project', label: 'Project' },
];

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
  onMoveTaskToProject,
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

  const grouped = useMemo(
    () => groupScheduleRuns(tasks, scheduleRunsIndex),
    [tasks, scheduleRunsIndex],
  );

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
    const latest = latestRun(row.runs);
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
          icon: Ico.chats(20),
          title: 'No tasks yet',
          description: 'Start a conversation from the home screen — every chat shows up here.',
          className: 'mx-8 mb-8',
        }}
      >
        <ListGroup className="mx-8 mb-8">
          {visible.map((row) => {
            if (row.kind === 'task') {
              return (
                <TaskRow
                  key={row.task.id}
                  {...chatTaskRow(row.task, { projects, onOpenProject })}
                  onOpen={() => onOpenTask?.(row.task.id)}
                  menuItems={chatTaskMenu(row.task, { onMoveToProject: onMoveTaskToProject, onDelete: onDeleteTask })}
                />
              );
            }
            return (
              <ScheduleGroupRow
                key={`sched:${row.scheduledId}`}
                schedule={schedulesById.get(row.scheduledId)}
                runs={row.runs}
                projects={projects}
                onOpenSchedule={() => onOpenSchedule?.(row.scheduledId)}
                onOpenTask={onOpenTask}
                onOpenProject={onOpenProject}
              />
            );
          })}
        </ListGroup>
      </CollectionState>
    </div>
  );
}
