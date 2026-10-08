// Collection-kit rows for a list of conversations, shared by the all-tasks
// page and a project's task list. Every run of one schedule collapses into a
// single group row that opens the schedule.

import { projectLabel } from '../../lib/projectLabel';
import Ico from '../Icons';
import { Badge, Button, Tooltip } from '../ui';
import { relativeAge } from '../../lib/formatTime';
import { HoverActions, ListItem, StatusDot } from '../collection';

export const ts = (raw) => {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
};

export const latestRun = (runs) => runs.reduce((max, r) =>
  ts(r.updatedAt || r.subtitle) > ts(max?.updatedAt || max?.subtitle) ? r : max,
runs[0]);

// Lone tasks pass through as { kind: 'task' }; runs of one schedule roll into
// a single { kind: 'group' } at the position of the first run. The index is a
// fallback for older records saved before `scheduledId` was plumbed.
export function groupScheduleRuns(tasks, scheduleRunsIndex = {}) {
  const out = [];
  const groups = new Map();
  for (const t of tasks || []) {
    const sid = t.scheduledId || scheduleRunsIndex[t.id] || null;
    if (!sid) {
      out.push({ kind: 'task', task: t });
      continue;
    }
    const task = t.scheduledId ? t : { ...t, scheduledId: sid };
    let g = groups.get(sid);
    if (!g) {
      g = { kind: 'group', scheduledId: sid, runs: [] };
      groups.set(sid, g);
      out.push(g);
    }
    g.runs.push(task);
  }
  return out;
}

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

// `projects` is omitted inside a project, where every row's project is the
// page's own.
export function TaskRow({ task, projects, onOpen, onOpenProject, actions }) {
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
          {projects && (
            <ProjectMeta projectName={task.projectName || task.project || ''} projects={projects} onOpenProject={onOpenProject} />
          )}
          {task.status === 'active' && <StatusDot tone="success">Running</StatusDot>}
          <span className="whitespace-nowrap">{updated}</span>
        </RowMeta>
      )}
      actions={actions}
    />
  );
}

export function ScheduleGroupRow({
  schedule, runs = [], projects,
  onOpenSchedule, onOpenLatest, onOpenProject,
}) {
  const latest = latestRun(runs);
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
          {projects && (
            <ProjectMeta
              projectName={schedule?.project || runs[0]?.projectName || runs[0]?.project || ''}
              projects={projects}
              onOpenProject={onOpenProject}
            />
          )}
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
