// `<ScheduleCard>` — grid view tile for one scheduled task.
//
// Width matches the projects-grid minimum (280px). Row 1 pairs the
// title with a status badge; a cadence + next-run line and the
// run-now/pause/edit hover row follow.
//
// Click anywhere on the card body opens the detail page. Hover reveals
// inline actions (Run now, Pause/Resume, Edit) at the bottom — they
// don't navigate, so they stop propagation.

import { useState } from 'react';
import Ico from '../Icons';
import { Card, Button } from '../ui';
import { relativeTime } from '../../lib/formatTime';
import { ScheduleStatusBadge } from './ScheduleStatusBadge';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';

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
  onOpen, onRunNow, onPause, onResume, onEdit,
}) {
  const [hover, setHover] = useState(false);

  const open  = () => onOpen?.(task);
  const stop  = (e) => { e.stopPropagation(); };

  const projectName = task.project || task.projectName || '';
  const projectMatch = projectName
    ? projects.find((p) => p.name === projectName) || null
    : null;
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  return (
    <Card
      as="div"
      interactive
      padding="cozy"
      onActivate={open}
      // `hover` still drives the action-row opacity reveal below; the card's
      // own lift/shadow now comes from `.card.interactive:hover` (CSS).
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      {/* Title + prompt preview. Row 1 pairs the title (display font,
          2-line clamp so cards align in the grid) with the status
          badge on the right; prompt preview sits below. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 8,
        }}>
          <div className="s-h3" style={{
            color: 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
          }}>
            {task.title || 'Untitled schedule'}
          </div>
          <span style={{ flexShrink: 0 }}>
            <ScheduleStatusBadge task={task} size="sm" />
          </span>
        </div>
        {task.prompt && (
          <div style={{
            fontFamily: FONT_BODY, fontSize: 12.5,
            color: 'var(--ink-3)', lineHeight: 1.45,
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3,
          }}>
            {task.prompt}
          </div>
        )}
      </div>

      {task.lastError && (
        <div style={{
          padding: '6px 8px', borderRadius: 6,
          background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
          fontSize: 11.5, color: 'var(--danger)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={task.lastError}>
          {task.lastError}
        </div>
      )}

      {/* Project label — mirrors ArtifactBubble's `project: <name>`.
          Clickable when we can resolve the name to a project object;
          otherwise rendered plainly. Hidden entirely when the task
          has no project (older schedules pre-fix all hit this). */}
      {projectName && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
          display: 'flex', alignItems: 'baseline', gap: 4,
          minWidth: 0,
        }}>
          <span style={{ flexShrink: 0 }}>project:</span>
          {canOpenProject ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              title={`Open ${projectMatch.name}`}
              style={{
                all: 'unset', cursor: 'pointer',
                color: 'var(--ink-3)', minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'color 120ms ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
                e.currentTarget.style.textDecoration = 'underline';
                e.currentTarget.style.textUnderlineOffset = '2px';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = 'var(--ink-3)';
                e.currentTarget.style.textDecoration = 'none';
              }}
            >{projectName}</button>
          ) : (
            <span style={{
              color: 'var(--ink-3)', minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{projectName}</span>
          )}
        </div>
      )}

      {/* Meta row — cadence + next run, or just cadence when paused
          (the badge above already says "Paused" — no need to repeat
          it here). Tooltip carries the absolute timestamp for users
          who want it precise. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8,
        fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-3)',
      }}>
        <span title={absoluteTime(task.nextRunAt)} style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.enabled
            ? <>{cadenceLabel(task.cadence)} · Next run <strong style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{relativeTime(task.nextRunAt) ?? '—'}</strong></>
            : <>{cadenceLabel(task.cadence)}</>}
        </span>
        {task.lastRunAt && (
          <span title={absoluteTime(task.lastRunAt)} style={{ color: 'var(--ink-4)' }}>
            Last · {relativeTime(task.lastRunAt) ?? '—'}
          </span>
        )}
      </div>

      {/* Missed-runs note — appears under the meta row only when the
          schedule slipped one or more cycles while the app was off.
          Cleared automatically on the next successful run; purely
          informational, no action required. */}
      {Number(task.missedRuns) > 0 && (
        <div style={{
          fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-4)',
          marginTop: -4,
        }}>
          Missed {task.missedRuns} run{task.missedRuns === 1 ? '' : 's'} while the app was closed.
        </div>
      )}

      {/* Hover-revealed action row. Always rendered to keep layout
          stable; opacity fades up on hover so the card stays calm at
          rest. Click handlers stop propagation so action buttons
          don't trigger the card's open. */}
      <div
        onClick={stop}
        onMouseDown={stop}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          paddingTop: 4, marginTop: 'auto',
          opacity: hover ? 1 : 0,
          transition: 'opacity 140ms ease',
          pointerEvents: hover ? 'auto' : 'none',
        }}
      >
        <ActionButton
          icon={Ico.send ? Ico.send(12) : '▶'}
          label="Run now"
          onClick={() => onRunNow?.(task)}
          busy={busy}
        />
        {task.enabled ? (
          <ActionButton
            icon={Ico.pause ? Ico.pause(12) : '⏸'}
            label="Pause"
            onClick={() => onPause?.(task)}
            busy={busy}
          />
        ) : (
          <ActionButton
            icon={Ico.power ? Ico.power(12) : '▶'}
            label="Resume"
            onClick={() => onResume?.(task)}
            busy={busy}
          />
        )}
        <ActionButton
          icon={Ico.edit ? Ico.edit(12) : '✎'}
          label="Edit"
          onClick={() => onEdit?.(task)}
          busy={busy}
        />
      </div>
    </Card>
  );
}


function ActionButton({ icon, label, onClick, busy }) {
  return (
    <Button onClick={onClick} disabled={busy}>
      {icon}
      {label}
    </Button>
  );
}
