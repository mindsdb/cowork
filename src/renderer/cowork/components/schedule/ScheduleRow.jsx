// `<ScheduleRow>` — one scheduled task as a collection-kit list row.
//
// Clicking the title (stretched over the row) opens the detail page. Run and
// the ⋮ menu stay visible at rest. The project link sits above the row's
// click area, so it opens the project without opening the schedule.

import Ico from '../Icons';
import { projectLabel } from '../../lib/projectLabel';
import { Button, Spinner, Tooltip } from '../ui';
import { ItemActions, ListItem, StatusDot } from '../collection';
import OverflowMenu from '../OverflowMenu';
import { relativeTime } from '../../lib/formatTime';
import { scheduleStatusBadge } from './ScheduleStatusBadge';

function absoluteTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function cadenceLabel(cadence) {
  return {
    once:     'One-off',
    hourly:   'Hourly',
    daily:    'Daily',
    weekdays: 'Weekdays',
    weekly:   'Weekly',
  }[cadence] || cadence;
}

export default function ScheduleRow({
  task, busy = false, projects = [], onOpenProject,
  onOpen, onRunNow, onPause, onResume, onEdit, onDelete,
}) {
  // Resolve the project name from the stored id (server keys by UUID, ENG-1255).
  const projectMatch = task.projectId
    ? projects.find((p) => p.id === task.projectId) || null
    : null;
  // One variable, and it holds the label. TasksView keeps a second, slug-valued
  // local because its rows match a project by name; this item resolves by
  // `task.projectId` above, so it needs the slug for nothing (ENG-1676).
  const projectDisplay = projectLabel(projectMatch) || '';
  const missed = Number(task.missedRuns) || 0;
  const status = scheduleStatusBadge(task);

  // A fixed cap so a long name truncates. The row's meta sizes to its content
  // (shrink-0 on desktop, min-width:auto on phones), and only a definite max
  // width limits that; a percentage would not. 11rem fits a 320px phone row.
  const project = projectDisplay && (
    <span className="flex min-w-0 max-w-[11rem] items-center gap-1.5 sm:max-w-[16rem]">
      <span className="inline-flex shrink-0">{Ico.folder(12)}</span>
      {projectMatch && typeof onOpenProject === 'function' ? (
        <ItemActions className="min-w-0 shrink">
          <Tooltip content={`Open ${projectDisplay}`}>
            <button
              type="button"
              onClick={() => onOpenProject(projectMatch)}
              className="m-0 min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-body text-xs text-ink-3 hover:text-accent hover:underline hover:underline-offset-2"
            >{projectDisplay}</button>
          </Tooltip>
        </ItemActions>
      ) : (
        <span title={projectDisplay} className="min-w-0 truncate text-ink-3">{projectDisplay}</span>
      )}
    </span>
  );

  // Enabled tasks show the next run; paused ones show the cadence.
  const when = (
    <span title={task.enabled ? absoluteTime(task.nextRunAt) : undefined} className="whitespace-nowrap">
      {task.enabled
        ? <>Next <span className="text-ink-3">{relativeTime(task.nextRunAt) ?? '—'}</span></>
        : cadenceLabel(task.cadence)}
    </span>
  );
  // Badge variants (accent, muted, danger, success) are StatusDot tones.
  const statusDot = <StatusDot tone={status.variant}>{status.label}</StatusDot>;

  return (
    <ListItem
      leading={Ico.clock(16)}
      title={task.title || 'Untitled schedule'}
      description={task.prompt || undefined}
      onActivate={() => onOpen?.(task)}
      actions={(
          <>
            <Button variant="subtle" size="sm" onClick={() => onRunNow?.(task)} disabled={busy}>
              {busy ? <Spinner /> : Ico.send(14)}
              Run
            </Button>
            <OverflowMenu
              items={taskMenuItems({ task, onEdit, onPause, onResume, onDelete })}
              disabled={busy}
              align="end"
              icon={Ico.moreVert(16)}
              size="sm"
            />
          </>
      )}
      meta={(
        <>
          {project}
          {/* Runs that slipped while the app was closed; cleared on the next run. */}
          {missed > 0 && <span className="whitespace-nowrap">Missed {missed}</span>}
          {task.enabled && <span>{cadenceLabel(task.cadence)}</span>}
          {when}
          {statusDot}
        </>
      )}
    />
  );
}

// Overflow-menu items for the row. Delete routes to the
// caller's confirm flow (a ConfirmModal), not an inline delete.
export function taskMenuItems({ task, onEdit, onPause, onResume, onDelete }) {
  return [
    { id: 'edit', label: 'Edit', icon: Ico.edit ? Ico.edit(14) : null, onClick: () => onEdit?.(task) },
    task.enabled
      ? { id: 'pause', label: 'Pause', icon: Ico.pause ? Ico.pause(14) : null, onClick: () => onPause?.(task) }
      : { id: 'resume', label: 'Resume', icon: Ico.power ? Ico.power(14) : null, onClick: () => onResume?.(task) },
    { separator: true },
    { id: 'delete', label: 'Delete', icon: Ico.trash ? Ico.trash(14) : null, danger: true, onClick: () => onDelete?.(task) },
  ];
}
