// `<ScheduleCard>` / `<ScheduleRow>` — one scheduled task as a grid card or a
// list row. Both are built from one set of collection-kit slots, so the view
// toggle changes layout, not content.
//
// Clicking the title (stretched over the item) opens the detail page. Run now
// and the ⋮ menu reveal on hover, focus, an open menu, and touch, and stay
// visible while an action is in flight. The project link sits above the
// item's click area, so it opens the project without opening the schedule.

import Ico from '../Icons';
import { projectLabel } from '../../lib/projectLabel';
import { Alert, Button, Spinner, Tooltip } from '../ui';
import { HoverActions, ItemCard, ListItem, StatusDot } from '../collection';
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

// One slot builder for both layouts: same facts, same order.
function scheduleSlots({
  task, busy = false, projects = [], onOpenProject, layout,
  onOpen, onRunNow, onPause, onResume, onEdit, onDelete,
}) {
  const row = layout === 'row';
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

  return {
    leading: row ? Ico.clock(16) : undefined,
    title: task.title || 'Untitled schedule',
    description: task.prompt || undefined,
    onActivate: () => onOpen?.(task),
    // Rows keep the list's short "Run"; cards say "Run now".
    actions: (
      <>
        <Button variant="subtle" size="sm" onClick={() => onRunNow?.(task)} disabled={busy}>
          {busy ? <Spinner /> : Ico.send(13)}
          {row ? 'Run' : 'Run now'}
        </Button>
        <OverflowMenu
          items={taskMenuItems({ task, onEdit, onPause, onResume, onDelete })}
          disabled={busy}
          align="end"
          icon={Ico.moreVert(16)}
          size="sm"
        />
      </>
    ),
    revealActions: busy,
    meta: row ? (
      <>
        {project}
        {/* Runs that slipped while the app was closed; cleared on the next run. */}
        {missed > 0 && <span className="whitespace-nowrap">Missed {missed}</span>}
        {task.enabled && <span>{cadenceLabel(task.cadence)}</span>}
        {when}
        {statusDot}
      </>
    ) : (
      <>
        {project}
        <span className={`flex shrink-0 items-center gap-3 ${projectDisplay ? 'ml-auto' : ''}`}>{statusDot}{when}</span>
      </>
    ),
    children: !row && (task.lastError || missed > 0) && (
      <>
        {task.lastError && (
          <Alert variant="danger" className="p-2 text-xs">
            <span className="block truncate" title={task.lastError}>{task.lastError}</span>
          </Alert>
        )}
        {missed > 0 && (
          <div className="font-body text-xs text-ink-4">
            Missed {missed} run{missed === 1 ? '' : 's'} while the app was closed.
          </div>
        )}
      </>
    ),
  };
}

export default function ScheduleCard(props) {
  return <ItemCard {...scheduleSlots({ ...props, layout: 'card' })} />;
}

export function ScheduleRow(props) {
  return <ListItem {...scheduleSlots({ ...props, layout: 'row' })} />;
}

// Overflow-menu items shared by the card and the list row. Delete routes to the
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
