// `<ScheduleDetailView>` — drilldown for a single scheduled task.
//
// Header: breadcrumb "Scheduled tasks › {title}".
// Hero card: status, prompt preview, run-now button, enable toggle,
//            next-run + last-run summary lines.
// Health: 30-run sparkline showing success/error rate, plus headline
//         metrics (total runs, success rate, avg duration).
// Runs list: each past run with timestamp, duration, status badge,
//            click-through to the conversation that ran.

import { useEffect, useMemo, useState } from 'react';
import Ico from '../components/Icons';
import { fetchScheduleRuns } from '../api';
import ScheduleTaskModal from '../components/schedule/ScheduleTaskModal';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';

// ── time helpers ──

function relativeTime(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const now = Date.now();
  const diff = t - now;
  const abs = Math.abs(diff);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  let value, unit;
  if (abs < minute)        { value = Math.round(abs / 1000);  unit = 's'; }
  else if (abs < hour)     { value = Math.round(abs / minute); unit = 'm'; }
  else if (abs < day)      { value = Math.round(abs / hour);   unit = 'h'; }
  else if (abs < 30 * day) { value = Math.round(abs / day);    unit = 'd'; }
  else return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}


// ── breadcrumb ──
//
// Mirrors ProjectsView's Crumb / CrumbSep so the navigation rhythm
// (Josefin Sans, 13px buttons, 14px separator + active label, slightly
// looser letter-spacing) is identical across drilldown surfaces.

function CrumbButton({ label, onClick, title, maxWidth }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      style={{
        // outline:0 removed for WCAG 2.4.7 — keyboard focus relies on
        // the global `button:focus:not(:focus-visible) { outline:none }`
        // rule, which keeps the ring for true keyboard nav.
        cursor: 'pointer', background: 'transparent', border: 0,
        fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13,
        letterSpacing: '0.04em', color: 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth, flexShrink: 1,
        padding: '2px 6px', borderRadius: 5,
        transition: 'color 120ms ease, background 120ms ease',
        WebkitAppRegion: 'no-drag',
      }}
      onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseOut={(e)  => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
    >{label}</button>
  );
}

function CrumbSep() {
  return (
    <span aria-hidden="true" style={{
      color: 'var(--ink-4)', fontFamily: FONT_DISPLAY,
      fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0,
      userSelect: 'none',
    }}>›</span>
  );
}


// ── pills ──

function StatusPill({ task }) {
  const cfg = (() => {
    if (!task.enabled)  return { label: 'Paused',          fg: 'var(--ink-3)' };
    if (task.lastError) return { label: 'Last run failed', fg: 'var(--danger)' };
    return { label: 'Active', fg: 'var(--success)' };
  })();
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      background: `color-mix(in srgb, ${cfg.fg} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${cfg.fg} 32%, transparent)`,
      color: cfg.fg,
      fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600,
    }}>
      <span style={{
        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
        background: 'currentColor',
      }} />
      {cfg.label}
    </span>
  );
}


// ── enable toggle ──
//
// Slim, accessible — clicks fire a debounced server call. Disabled
// while busy. Visual reads as on/off no-matter-the-light.

function EnableToggle({ enabled, onChange, busy }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? 0.6 : 1,
    }}>
      {/* Track + thumb live in a positioned wrapper so the absolute-
          positioned thumb anchors to the track itself. Earlier the
          thumb was a sibling of the label with `position: absolute`
          but no positioned ancestor — it ended up anchored to the
          nearest higher-up positioned element and visually
          "floated" as the page scrolled. */}
      <span style={{
        position: 'relative',
        display: 'inline-block',
        width: 30, height: 18,
        flexShrink: 0,
      }}>
        <input
          type="checkbox"
          checked={!!enabled}
          disabled={busy}
          onChange={(e) => onChange?.(e.target.checked)}
          style={{
            appearance: 'none',
            width: 30, height: 18, borderRadius: 999,
            background: enabled ? 'var(--accent)' : 'var(--surface-2)',
            border: '1px solid var(--line)',
            transition: 'background 140ms ease',
            cursor: 'inherit',
            margin: 0,
            display: 'block',
          }}
        />
        {/* Thumb — absolutely positioned inside the track wrapper. */}
        <span aria-hidden style={{
          position: 'absolute',
          top: 2, left: enabled ? 14 : 2,
          width: 14, height: 14, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(15,16,17,0.18)',
          transition: 'left 140ms ease',
          pointerEvents: 'none',
        }} />
      </span>
      <span style={{
        fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
        color: enabled ? 'var(--ink-2)' : 'var(--ink-3)',
      }}>{enabled ? 'Enabled' : 'Paused'}</span>
    </label>
  );
}


// ── health chart (sparkline) ──
//
// 30 most-recent runs, oldest left → newest right. Each run is a
// vertical bar; height encodes duration on a log-ish scale (so a 5s
// success and a 5min success are both visible), color encodes status.
// Zero-effort SVG; no charting library needed for this scale.

function HealthSparkline({ runs }) {
  // Slice + reverse so the chart reads left-to-right by time.
  const chronological = useMemo(() => [...runs].slice(0, 30).reverse(), [runs]);
  if (!chronological.length) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 80, borderRadius: 10,
        border: '1px dashed var(--line-2)',
        color: 'var(--ink-4)', fontFamily: FONT_BODY, fontSize: 12.5,
      }}>
        No runs yet — health appears after the first run.
      </div>
    );
  }
  const W = 320, H = 80;
  const n = chronological.length;
  const slot = W / n;
  const barW = Math.max(2, Math.min(slot - 3, 10));
  // Log scaling on duration — 100ms minimum visible, cap at 10min.
  const minVisible = 100;
  const maxClamp   = 10 * 60_000;
  const heightFor = (ms) => {
    const v = Math.max(minVisible, Math.min(maxClamp, ms || minVisible));
    const t = Math.log(v) / Math.log(maxClamp); // 0..1
    return Math.max(6, t * (H - 12));
  };
  return (
    <svg
      role="img"
      aria-label="Run history sparkline"
      width="100%" height={H + 8}
      viewBox={`0 0 ${W} ${H + 8}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {chronological.map((run, i) => {
        const h = heightFor(run.durationMs);
        const x = i * slot + (slot - barW) / 2;
        const y = H - h;
        const fill = run.status === 'error'
          ? 'var(--danger)'
          : (run.manual ? 'var(--accent)' : 'var(--success)');
        return (
          <g key={run.id || i}>
            <title>
              {`${absoluteTime(run.startedAt)} · ${run.status}${run.manual ? ' (manual)' : ''} · ${formatDuration(run.durationMs)}`}
            </title>
            <rect x={x} y={y} width={barW} height={h} rx={2} fill={fill} opacity="0.95" />
          </g>
        );
      })}
      {/* Baseline. */}
      <line x1={0} x2={W} y1={H} y2={H} stroke="var(--line)" strokeWidth="1" />
    </svg>
  );
}


// ── runs list ──

function RunRow({ run, onOpen }) {
  const isErr = run.status === 'error';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '12px 1fr auto auto',
        alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
      }}
    >
      <span aria-hidden style={{
        width: 8, height: 8, borderRadius: '50%',
        background: isErr ? 'var(--danger)' : (run.manual ? 'var(--accent)' : 'var(--success)'),
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={absoluteTime(run.startedAt)}>
          {absoluteTime(run.startedAt) || '—'}
          {run.manual && <span style={{
            marginLeft: 8, padding: '1px 6px', borderRadius: 4,
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            color: 'var(--accent)',
            fontSize: 10.5, fontWeight: 600,
          }}>MANUAL</span>}
        </div>
        {isErr && run.error && (
          <div style={{
            fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--danger)',
            marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={run.error}>{run.error}</div>
        )}
      </div>
      <span style={{
        fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-3)',
        whiteSpace: 'nowrap',
      }}>{formatDuration(run.durationMs)}</span>
      {run.sessionId ? (
        <button
          type="button"
          onClick={() => onOpen?.(run)}
          style={{
            background: 'transparent', border: '1px solid var(--line)',
            color: 'var(--ink-2)',
            padding: '4px 9px', borderRadius: 6,
            fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 500,
            cursor: 'pointer',
          }}
          onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--ink)'; }}
          onMouseOut={(e)  => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--ink-2)'; }}
        >Open task</button>
      ) : <span />}
    </div>
  );
}


// ── view ──

export default function ScheduleDetailView({
  task,
  projects = [],
  models = [],
  onBack,                   // → setRoute('scheduled')
  onOpenRunSession,         // (sessionId) → navigate to that conversation
  onUpdate,                 // (id, payload) → server PUT
  onDelete,                 // (id) → server DELETE; should also navigate back
  onPause,                  // (id)
  onResume,                 // (id)
  onRunNow,                 // (id)
  agentLabel,
}) {
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const taskId = task?.id;

  useEffect(() => {
    if (!taskId) return;
    setLoadingRuns(true);
    fetchScheduleRuns(taskId, { limit: 100 })
      .then((data) => setRuns(Array.isArray(data?.runs) ? data.runs : []))
      .catch(() => setRuns([]))
      .finally(() => setLoadingRuns(false));
  }, [taskId, task?.lastRunAt]);  // refresh when host reports a fresh run

  const stats = useMemo(() => {
    if (!runs.length) return { total: 0, success: 0, error: 0, rate: null, avgMs: null };
    const success = runs.filter((r) => r.status === 'success').length;
    const errored = runs.length - success;
    const durations = runs.map((r) => r.durationMs).filter((v) => Number.isFinite(v) && v > 0);
    const avgMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;
    return {
      total:   runs.length,
      success, error: errored,
      rate: success / runs.length,
      avgMs,
    };
  }, [runs]);

  if (!task) {
    return (
      <div className="scroll-clean" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: FONT_BODY, color: 'var(--ink-3)' }}>
          Schedule not found.{' '}
          <button onClick={onBack} style={{
            background: 'transparent', border: 0, color: 'var(--accent)', cursor: 'pointer',
          }}>Back to scheduled tasks</button>
        </div>
      </div>
    );
  }

  async function withBusy(fn) {
    setBusy(true);
    setError('');
    try { await fn(); }
    catch (err) { setError(err?.message || 'Action failed.'); }
    finally     { setBusy(false); }
  }

  return (
    <div className="scroll-clean" style={{
      flex: 1, overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
      fontFamily: FONT_BODY,
    }}>
      {/* Breadcrumb header — matches ProjectsView typography exactly
          so drilldown surfaces feel like one family. */}
      <div className="sched-crumb" style={{
        padding: '14px 28px 8px',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <CrumbButton label="Scheduled Tasks" onClick={onBack} title="All scheduled tasks" />
        <CrumbSep />
        <span style={{
          padding: '2px 6px',
          fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14,
          letterSpacing: '0.04em', color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360,
        }}>{task.title || 'Untitled schedule'}</span>
      </div>

      <div className="sched-body" style={{ padding: '6px 28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {error && (
          <div style={{
            padding: '8px 10px', borderRadius: 7,
            background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
            color: 'var(--danger)', fontSize: 12.5,
          }}>{error}</div>
        )}

        {/* Hero card — title, status, run-now, enable toggle, next-run */}
        <div className="sched-hero" style={{
          padding: '18px 22px',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div className="sched-hero-top" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600,
                color: 'var(--ink)', letterSpacing: '-0.01em', lineHeight: 1.25,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
              }}>{task.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <StatusPill task={task} />
                <span style={{
                  fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)',
                }}>
                  {task.cadence === 'once' ? 'One-off run' : `Runs ${task.cadence}`}
                </span>
              </div>
            </div>
            <div className="sched-hero-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <EnableToggle
                enabled={task.enabled}
                busy={busy}
                onChange={(next) => withBusy(async () => {
                  if (next) await onResume?.(task.id);
                  else      await onPause?.(task.id);
                })}
              />
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                disabled={busy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 7,
                  background: 'transparent',
                  border: '1px solid var(--line)',
                  color: 'var(--ink-2)',
                  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {Ico.edit ? Ico.edit(13) : null} Edit
              </button>
              <button
                type="button"
                onClick={() => withBusy(() => onRunNow?.(task.id))}
                disabled={busy}
                className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {Ico.send ? Ico.send(13) : null}
                {busy ? 'Running…' : 'Run now'}
              </button>
            </div>
          </div>

          {/* Prompt preview. */}
          {task.prompt && (
            <div style={{
              padding: '12px 14px',
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-2)',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              maxHeight: 168, overflowY: 'auto',
            }}>{task.prompt}</div>
          )}

          {/* Next + last run summary. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
          }}>
            <SummaryStat
              label="Next run"
              value={task.enabled ? relativeTime(task.nextRunAt) : 'Paused'}
              hint={absoluteTime(task.nextRunAt)}
            />
            <SummaryStat
              label="Last run"
              value={task.lastRunAt ? relativeTime(task.lastRunAt) : '—'}
              hint={absoluteTime(task.lastRunAt)}
            />
            <SummaryStat
              label="Project"
              value={task.projectPath ? lastSegment(task.projectPath) : '—'}
              hint={task.projectPath || ''}
            />
            <SummaryStat
              label="Model"
              value={task.model || 'default'}
            />
          </div>
        </div>

        {/* Health card. */}
        <div className="sched-health" style={{
          padding: '18px 22px',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div className="sched-health-top" style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 12,
          }}>
            <div>
              <div style={{
                fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600,
                color: 'var(--ink)',
              }}>Health</div>
              <div style={{
                fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)',
                marginTop: 2,
              }}>Last {Math.min(stats.total, 30)} runs · success rate, duration, error frequency.</div>
            </div>
            <div className="sched-health-metrics" style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
              <Metric label="Total runs" value={stats.total} />
              <Metric
                label="Success rate"
                value={stats.rate == null ? '—' : `${Math.round(stats.rate * 100)}%`}
                color={stats.rate == null ? null : (stats.rate >= 0.95 ? 'var(--success)' : (stats.rate >= 0.8 ? 'var(--accent)' : 'var(--danger)'))}
              />
              <Metric
                label="Avg duration"
                value={stats.avgMs == null ? '—' : formatDuration(stats.avgMs)}
              />
            </div>
          </div>
          <HealthSparkline runs={runs} />
        </div>

        {/* Runs list. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 2px',
          }}>
            <div style={{
              fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600,
              color: 'var(--ink)',
            }}>
              Recent runs
              <span style={{
                marginLeft: 8, fontWeight: 500,
                color: 'var(--ink-4)', fontSize: 12,
              }}>{runs.length}</span>
            </div>
            {loadingRuns && (
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Loading…</span>
            )}
          </div>
          {runs.length === 0 && !loadingRuns ? (
            <div style={{
              padding: 18, borderRadius: 10,
              border: '1px dashed var(--line-2)',
              color: 'var(--ink-4)', textAlign: 'center', fontSize: 12.5,
            }}>No runs yet. Click <strong>Run now</strong> to fire a manual one.</div>
          ) : (
            runs.map((run) => (
              <RunRow
                key={run.id || run.startedAt}
                run={run}
                onOpen={() => run.sessionId && onOpenRunSession?.(run.sessionId)}
              />
            ))
          )}
        </div>
      </div>

      <ScheduleTaskModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={async (payload, id) => onUpdate?.(id, payload)}
        onDelete={async (id) => {
          await onDelete?.(id);
          // Host should setRoute('scheduled') on delete via onDelete.
        }}
        task={task}
        projects={projects}
        models={models}
        agentLabel={agentLabel}
      />
    </div>
  );
}


function SummaryStat({ label, value, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{
        fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600,
        color: 'var(--ink-3)', letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>{label}</div>
      <div title={hint || undefined} style={{
        fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
        color: 'var(--ink)', letterSpacing: '-0.005em',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-4)',
        letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600,
      }}>{label}</div>
      <div style={{
        fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600,
        color: color || 'var(--ink)', letterSpacing: '-0.005em',
        marginTop: 2,
      }}>{value}</div>
    </div>
  );
}

function lastSegment(path) {
  if (!path) return '';
  const parts = String(path).split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}
