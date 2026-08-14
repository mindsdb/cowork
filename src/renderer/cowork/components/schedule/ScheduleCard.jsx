// `<ScheduleCard>` — grid tile for one scheduled task.
//
// Actions (Run now + ⋮ menu) sit top-right and are always visible, not
// hover-revealed — a hover-only row is unreachable by keyboard focus and by
// touch/web. Clicking the card body opens the detail page; the action cluster
// stops propagation so its controls don't also navigate.

import Ico from '../Icons';
import { Alert, Card, Button, Spinner, Tooltip } from '../ui';
import OverflowMenu from '../OverflowMenu';
import { relativeTime } from '../../lib/formatTime';
import { ScheduleStatusBadge } from './ScheduleStatusBadge';

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

export default function ScheduleCard({
  task, busy = false,
  projects = [],
  onOpenProject,
  onOpen, onRunNow, onPause, onResume, onEdit, onDelete,
}) {
  const open  = () => onOpen?.(task);
  const stop  = (e) => { e.stopPropagation(); };

  // Resolve the project name from the stored id (server keys by UUID, ENG-1255).
  const projectMatch = task.projectId
    ? projects.find((p) => p.id === task.projectId) || null
    : null;
  const projectName = projectMatch?.name || '';
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  return (
    <Card
      as="div"
      interactive
      padding="cozy"
      onActivate={open}
      className="relative flex flex-col gap-2.5"
    >
      <div className="flex items-start gap-2.5">
        <div className="s-h3 line-clamp-2 min-w-0 flex-1">
          {task.title || 'Untitled schedule'}
        </div>

        <div
          onClick={stop}
          onMouseDown={stop}
          className="flex shrink-0 items-center gap-0.5"
        >
          <RunNowButton onClick={() => onRunNow?.(task)} busy={busy} />
          <OverflowMenu
            items={taskMenuItems({ task, onEdit, onPause, onResume, onDelete })}
            disabled={busy}
            align="end"
            icon={Ico.moreVert(16)}
            triggerClassName="h-7 w-7 justify-center rounded-md text-ink-4 hover:text-ink hover:bg-surface-2"
          />
        </div>
      </div>

      {task.prompt && (
        <div className="line-clamp-2 font-body text-sm leading-[1.45] text-ink-3">
          {task.prompt}
        </div>
      )}

      {task.lastError && (
        <Alert variant="danger" className="p-2 text-xs">
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={task.lastError}>
            {task.lastError}
          </span>
        </Alert>
      )}

      {/* Shown only when runs slipped while the app was closed; cleared on the next run. */}
      {Number(task.missedRuns) > 0 && (
        <div className="font-body text-xs text-ink-4">
          Missed {task.missedRuns} run{task.missedRuns === 1 ? '' : 's'} while the app was closed.
        </div>
      )}

      {/* Meta row (hairline): project origin left, status + schedule right.
          Enabled tasks show the next run; paused tasks show the cadence. */}
      {/* border-x-0/border-b-0 zero the other sides: preflight is disabled, so
          border-solid would otherwise reveal their default (medium) width. */}
      <div className="mt-auto flex min-w-0 items-center gap-2 border-x-0 border-b-0 border-t border-solid border-line pt-[11px]">
        {projectName && (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex shrink-0 text-ink-4">{Ico.folder(13)}</span>
            {canOpenProject ? (
              <Tooltip content={`Open ${projectMatch.name}`}>
                <button
                  type="button"
                  onMouseDown={stop}
                  onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenProject(projectMatch); } }}
                  className="m-0 min-w-0 cursor-pointer appearance-none truncate border-0 bg-transparent p-0 text-left font-body text-[12px] text-ink-3 transition-colors hover:text-accent hover:underline hover:underline-offset-2"
                >{projectName}</button>
              </Tooltip>
            ) : (
              <span title={projectName} className="min-w-0 truncate font-body text-[12px] text-ink-3">{projectName}</span>
            )}
          </span>
        )}

        <span className={`flex shrink-0 items-center gap-2 ${projectName ? 'ml-auto' : ''}`}>
          <ScheduleStatusBadge task={task} size="sm" />
          <span
            title={task.enabled ? absoluteTime(task.nextRunAt) : undefined}
            className="whitespace-nowrap font-body text-[12px] text-ink-4"
          >
            {task.enabled
              ? <>Next run <strong className="font-medium text-ink-3">{relativeTime(task.nextRunAt) ?? '—'}</strong></>
              : cadenceLabel(task.cadence)}
          </span>
        </span>
      </div>
    </Card>
  );
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

// Primary action — labeled (not icon-only); `subtle` is a quiet ghost. Busy
// shows a spinner and disables the click.
function RunNowButton({ onClick, busy }) {
  return (
    <Button
      variant="subtle"
      size="sm"
      onClick={onClick}
      disabled={busy}
      aria-label="Run now"
    >
      {busy ? <Spinner /> : (Ico.send ? Ico.send(13) : '▶')}
      Run now
    </Button>
  );
}
