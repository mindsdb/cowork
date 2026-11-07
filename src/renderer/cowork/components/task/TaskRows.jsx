// The one task row: Cowork's Tasks page, a project's task list, and Code
// Mode's task lists all render it, so a task looks the same everywhere. Rows
// differ only where the data does (a subtitle, a project, a status worth
// showing). Every run of one schedule collapses into a single group row that
// opens the schedule.

import { projectLabel } from '../../lib/projectLabel';
import Ico from '../Icons';
import { Badge, Button, Tooltip } from '../ui';
import { OverflowMenu } from '../OverflowMenu';
import { relativeAge } from '../../lib/formatTime';
import { ItemActions, ListItem, StatusDot } from '../collection';

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

// Project in a row's meta: a link above the row's own click area when it can
// open, plain text otherwise. The cap keeps a long name from widening the
// meta, which sizes to its content; `shrink` lets the label truncate inside it.
function ProjectMeta({ label, onOpen }) {
  return (
    <span className="flex min-w-0 max-w-[16rem] items-center gap-1.5 max-sm:max-w-[8rem]">
      <span className="inline-flex shrink-0">{Ico.folder(12)}</span>
      {onOpen ? (
        <ItemActions className="min-w-0 shrink">
          <Tooltip content={`Open ${label}`}>
            <button
              type="button"
              onClick={onOpen}
              className="m-0 min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-body text-xs text-ink-3 hover:text-accent hover:underline hover:underline-offset-2"
            >{label}</button>
          </Tooltip>
        </ItemActions>
      ) : (
        <span title={label} className="min-w-0 truncate text-ink-3">{label}</span>
      )}
    </span>
  );
}

export function TaskRow({
  title, subtitle, project, status, updatedAt, onOpen,
  menuItems, leading = Ico.chats(16), badges, actions, className,
}) {
  const stamp = ts(updatedAt);
  const age = relativeAge(stamp || null);
  return (
    <ListItem
      leading={leading}
      title={title || 'Untitled task'}
      badges={badges}
      description={subtitle || undefined}
      onActivate={onOpen}
      className={className}
      meta={(
        // Wraps onto a second line when a narrow phone can't fit it all.
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {project && <ProjectMeta label={project.label} onOpen={project.onOpen} />}
          {status && <StatusDot tone={status.tone}>{status.label}</StatusDot>}
          {age
            ? <time dateTime={new Date(stamp).toISOString()} title={new Date(stamp).toLocaleString()} className="whitespace-nowrap">{age}</time>
            : <span>—</span>}
        </span>
      )}
      actions={actions ?? (menuItems?.length
        ? <OverflowMenu size="sm" label={`Actions for ${title || 'untitled task'}`} items={menuItems} />
        : undefined)}
    />
  );
}

// Cowork task → row props. `projects` is omitted inside a project, where
// every row's project is the page's own.
export function chatTaskRow(task, { projects, onOpenProject } = {}) {
  const updatedAt = task.updatedAt || task.subtitle || task.created_at;
  const age = relativeAge(updatedAt);
  return {
    title: task.title,
    // Older records stamp a display time into `subtitle`; it isn't a subtitle.
    subtitle: task.subtitle && task.subtitle !== age ? task.subtitle : undefined,
    project: projects && chatProject(task.projectName || task.project, projects, onOpenProject),
    status: task.status === 'active' ? { label: 'Running', tone: 'accent' } : null,
    updatedAt,
  };
}

function chatProject(name, projects, onOpenProject) {
  if (!name) return null;
  const match = projects.find((p) => p.name === name) || null;
  // An unresolved project falls back to its slug.
  const label = projectLabel(match) || name;
  return { label, onOpen: match && onOpenProject ? () => onOpenProject(match) : undefined };
}

export function chatTaskMenu(task, { onMoveToProject, onDelete }) {
  return [
    onMoveToProject && { id: 'move', icon: Ico.moveTo(14), label: 'Move to project…', onClick: () => onMoveToProject(task) },
    onMoveToProject && onDelete && { divider: true },
    onDelete && { id: 'delete', icon: Ico.trash(14), label: 'Delete', danger: true, onClick: () => onDelete(task.id) },
  ].filter(Boolean);
}

export function ScheduleGroupRow({ schedule, runs = [], projects, onOpenSchedule, onOpenTask, onOpenProject }) {
  const latest = latestRun(runs);
  const running = runs.some((r) => r.status === 'active');
  return (
    <TaskRow
      leading={Ico.schedule(16)}
      title={schedule?.title || latest?.title || 'Scheduled task'}
      badges={(
        <Badge variant="accent" size="sm" className="shrink-0 uppercase tracking-[0.06em]">
          {runs.length} {runs.length === 1 ? 'run' : 'runs'}
        </Badge>
      )}
      project={projects && chatProject(schedule?.project || latest?.projectName || latest?.project, projects, onOpenProject)}
      status={running ? { label: 'Running', tone: 'accent' } : null}
      updatedAt={latest?.updatedAt || latest?.subtitle || schedule?.lastRunAt}
      // The row opens the schedule (where per-run history lives); the hover
      // action jumps straight to the most recent run.
      onOpen={onOpenSchedule}
      className="bg-[color-mix(in_srgb,var(--accent)_4%,transparent)]"
      actions={(
        <Tooltip content="Open latest run">
          <Button variant="subtle" icon size="sm" onClick={() => latest?.id && onOpenTask?.(latest.id)} aria-label="Open latest run">
            {Ico.externalLink(14)}
          </Button>
        </Tooltip>
      )}
    />
  );
}
