// `<ScheduleCard>` — grid view tile for one scheduled task.
//
// Width matches the projects-grid minimum (280px); height runs taller
// (~220-240) to make room for the prompt preview, the cadence/status
// pills, the next-run line, and the run-now/pause/edit hover row.
//
// Click anywhere on the card body opens the detail page. Hover reveals
// inline actions (Run now, Pause/Resume, Edit) at the bottom — they
// don't navigate, so they stop propagation.

import { useState } from 'react';
import Ico from '../Icons';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';

// Format an ISO timestamp into a relative phrase ("in 3 hours", "5
// minutes ago"). Fall back to a clean date if it's far away. Keep it
// punchy — cards are scannable, not paragraphs.
function relativeTime(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const now = Date.now();
  const diff = t - now; // negative = past
  const abs = Math.abs(diff);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  let value, unit;
  if (abs < minute)        { value = Math.round(abs / 1000);  unit = 's'; }
  else if (abs < hour)     { value = Math.round(abs / minute); unit = 'm'; }
  else if (abs < day)      { value = Math.round(abs / hour);   unit = 'h'; }
  else if (abs < 30 * day) { value = Math.round(abs / day);    unit = 'd'; }
  else {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    });
  }
  return diff >= 0 ? `in ${value}${unit}` : `${value}${unit} ago`;
}

function absoluteTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function StatusPill({ task }) {
  if (task.catchupPending) return <Pill color="amber" label="Catch up" />;
  if (!task.enabled)       return <Pill color="muted" label="Paused" />;
  if (task.lastError)      return <Pill color="danger" label="Last failed" />;
  return <Pill color="success" label="Active" />;
}

function Pill({ color, label }) {
  const bg = {
    success: 'color-mix(in srgb, var(--success) 14%, transparent)',
    danger:  'color-mix(in srgb, var(--danger) 14%, transparent)',
    amber:   'color-mix(in srgb, var(--accent) 14%, transparent)',
    muted:   'var(--surface-2)',
  }[color];
  const fg = {
    success: 'var(--success)',
    danger:  'var(--danger)',
    amber:   'var(--accent)',
    muted:   'var(--ink-3)',
  }[color];
  const bd = {
    success: 'color-mix(in srgb, var(--success) 35%, transparent)',
    danger:  'color-mix(in srgb, var(--danger) 35%, transparent)',
    amber:   'color-mix(in srgb, var(--accent) 35%, transparent)',
    muted:   'var(--line)',
  }[color];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 8px', borderRadius: 999,
      background: bg, border: `1px solid ${bd}`,
      color: fg,
      fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600,
      letterSpacing: '0.01em', whiteSpace: 'nowrap',
    }}>
      {color === 'success' && <span style={{
        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
        background: fg,
      }} />}
      {label}
    </span>
  );
}

function CadencePill({ cadence }) {
  const label = {
    once:   'One-off',
    hourly: 'Hourly',
    daily:  'Daily',
    weekly: 'Weekly',
  }[cadence] || cadence;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 999,
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
      color: 'var(--ink-2)',
      fontFamily: FONT_BODY, fontSize: 11, fontWeight: 500,
    }}>
      {Ico.clock ? Ico.clock(11) : null}
      {label}
    </span>
  );
}


export default function ScheduleCard({
  task, busy = false,
  onOpen, onRunNow, onPause, onResume, onEdit,
}) {
  const [hover, setHover] = useState(false);

  const open  = () => onOpen?.(task);
  const stop  = (e) => { e.stopPropagation(); };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: '14px 16px',
        minHeight: 220,
        background: 'var(--surface)',
        border: `1px solid ${hover ? 'var(--accent)' : 'var(--line)'}`,
        borderRadius: 12,
        cursor: 'pointer',
        font: 'inherit', color: 'inherit', textAlign: 'left',
        outline: 'none',
        transition: 'border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: hover ? '0 6px 22px rgba(15,16,17,0.06)' : 'none',
      }}
    >
      {/* Top row — cadence pill (left) + status pill (right). */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8,
      }}>
        <CadencePill cadence={task.cadence} />
        <StatusPill task={task} />
      </div>

      {/* Title + prompt preview. Title in display font, prompt in body
          font with a 2-line clamp so cards align in the grid. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
        <div style={{
          fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600,
          color: 'var(--ink)', letterSpacing: '-0.005em', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
        }}>
          {task.title || 'Untitled schedule'}
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

      {/* Meta row — next run + relative time. Tooltip carries the
          absolute timestamp for users who want it precise. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8,
        fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-3)',
      }}>
        <span title={absoluteTime(task.nextRunAt)} style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.enabled
            ? <>Next run · <strong style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{relativeTime(task.nextRunAt)}</strong></>
            : <>Paused</>}
        </span>
        {task.lastRunAt && (
          <span title={absoluteTime(task.lastRunAt)} style={{ color: 'var(--ink-4)' }}>
            Last · {relativeTime(task.lastRunAt)}
          </span>
        )}
      </div>

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
            icon={Ico.stop ? Ico.stop(12) : '⏸'}
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
    </div>
  );
}


function ActionButton({ icon, label, onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 9px', borderRadius: 6,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        color: 'var(--ink-2)',
        fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 500,
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.6 : 1,
        transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = 'var(--surface)';
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.color = 'var(--ink-2)';
      }}
    >
      <span style={{ display: 'inline-flex', color: 'currentColor' }}>{icon}</span>
      {label}
    </button>
  );
}
