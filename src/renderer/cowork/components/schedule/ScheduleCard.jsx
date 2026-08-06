// `<ScheduleCard>` — grid view tile for one scheduled task.
//
// Width matches the projects-grid minimum (280px). The header row pairs
// the title with a top-right cluster — status badge, a "Run now" button,
// and the ⋮ overflow menu (Edit / Pause-Resume / Delete). A cadence +
// next-run line and a "last run" caption follow.
//
// Actions live top-right and are ALWAYS visible (not hover-revealed): the
// old hover-only row was unreachable by keyboard focus and by touch/web
// (no hover), and hid the surface's primary verb. Calm comes from low
// emphasis (quiet ghost buttons), not from hiding. Click anywhere on the
// card body opens the detail page; the action cluster stops propagation so
// its controls don't also navigate.

import Ico from '../Icons';
import { Alert, Card, Button, Spinner } from '../ui';
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

// Cadence → display label. Was CadencePill; hoisted to a plain
// function now that the cadence reads inline in the footer meta row
// instead of its own pill.
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
  // `projects` + `onOpenProject` are optional — when both are
  // supplied the card surfaces a clickable "project: <name>" label
  // that routes to the project's detail page. Mirrors the pattern
  // ArtifactBubble uses on the Live artifacts page.
  projects = [],
  onOpenProject,
  onOpen, onRunNow, onPause, onResume, onEdit, onDelete,
}) {
  const open  = () => onOpen?.(task);
  const stop  = (e) => { e.stopPropagation(); };

  // The server keys the schedule's project by id (a UUID) — resolve the name
  // to display from `projects` (ENG-1255). `task.project`/`projectName` were
  // never sent by the server, so reading them showed a blank field.
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
      // Layout only; the card's lift/shadow comes from `.card.interactive:hover` (CSS).
      className="relative flex flex-col gap-2.5"
    >
      {/* Header row — title (2-line clamp) paired with the top-right actions:
          Run now + the ⋮ menu. Status has moved down to the meta row so this
          corner isn't three-up and cramped. Actions stop propagation so they
          don't also open the card; they're always visible so keyboard and
          touch/web reach them and the primary verb stays discoverable. */}
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
            // Quiet-but-present ghost icon button: muted at rest, gains a
            // hover surface + darker ink on hover — the same 28px hit
            // target the Live-artifacts / project cards use.
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

      {/* Missed-runs note — shown only when the schedule slipped one or more
          cycles while the app was off. Cleared on the next successful run;
          purely informational. */}
      {Number(task.missedRuns) > 0 && (
        <div className="font-body text-xs text-ink-4">
          Missed {task.missedRuns} run{task.missedRuns === 1 ? '' : 's'} while the app was closed.
        </div>
      )}

      {/* Meta row — the card's metadata under a hairline (the Project-card
          idiom). Project origin on the LEFT (the ArtifactBubble footer
          convention: origin left, temporal info right); status badge +
          schedule on the right. `mt-auto` drops the row to the card's baseline
          so meta rows align across a grid row. Enabled cards lead with the
          next run (the actionable fact); paused cards show the cadence instead
          — the badge already says "Paused", and there is no next run. Cadence
          for enabled tasks + last-run + absolute times live on the detail
          page. */}
      <div className="mt-auto flex min-w-0 items-center gap-2 border-t border-line pt-[11px]">
        {projectName && (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex shrink-0 text-ink-4">{Ico.folder(13)}</span>
            {canOpenProject ? (
              <button
                type="button"
                onMouseDown={stop}
                onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenProject(projectMatch); } }}
                title={`Open ${projectMatch.name}`}
                className="m-0 min-w-0 cursor-pointer appearance-none truncate border-0 bg-transparent p-0 text-left font-body text-[12px] text-ink-3 transition-colors hover:text-accent hover:underline hover:underline-offset-2"
              >{projectName}</button>
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

// Shared item list for the card and list-row overflow menus: Edit, the
// Pause/Resume toggle, then Delete (danger) under a divider. Delete routes to
// the surface's confirm flow (a ConfirmModal) rather than deleting inline.
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


// Primary verb of the surface. Kept LABELED (not a mystery-meat icon) and
// always visible — it's the one thing people come to this page to do. The
// `subtle` variant is a borderless ghost that only firms up on hover, so a
// grid of these reads calm at rest. Busy swaps the send glyph for a spinner
// and disables the click while a run is in flight.
function RunNowButton({ onClick, busy }) {
  return (
    <Button
      variant="subtle"
      size="sm"
      onClick={onClick}
      disabled={busy}
      title="Run now"
      aria-label="Run now"
    >
      {busy ? <Spinner /> : (Ico.send ? Ico.send(13) : '▶')}
      Run now
    </Button>
  );
}
