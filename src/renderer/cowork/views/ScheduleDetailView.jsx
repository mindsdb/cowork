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
import { PageHeader } from '../components/collection';
import { Alert, Button } from '../components/ui';
import { Switch } from '../components/ui/Switch';
import OverflowMenu from '../components/OverflowMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { fetchScheduleRuns } from '../api';
import ScheduleTaskModal from '../components/schedule/ScheduleTaskModal';
import { ScheduleStatusBadge } from '../components/schedule/ScheduleStatusBadge';
import { relativeTime } from '../lib/formatTime';

// ── time helpers ──

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

function runColor(run) {
  if (run.status === 'running') return 'var(--accent)';
  if (run.status === 'failed') return 'var(--danger)';
  if (run.status === 'cancelled') return 'var(--ink-4)';
  return run.isManual ? 'var(--accent)' : 'var(--success)';
}


// ── enable toggle ──
//
// Slim, accessible — clicks fire a debounced server call. Disabled
// while busy. Visual reads as on/off no-matter-the-light.

function EnableToggle({ enabled, onChange, busy }) {
  return (
    <label className="inline-flex items-center gap-2" style={{
      cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? 0.6 : 1,
    }}>
      <Switch
        checked={!!enabled}
        onCheckedChange={onChange}
        disabled={busy}
        size="sm"
        aria-label="Schedule enabled"
      />
      <span className="font-[family-name:var(--font-body)] text-sm font-medium" style={{
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
      <div className="flex items-center justify-center h-20 rounded-card border border-dashed border-line-2 text-ink-4 font-[family-name:var(--font-body)] text-sm">
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
      className="block"
    >
      {chronological.map((run, i) => {
        const h = heightFor(run.durationMs);
        const x = i * slot + (slot - barW) / 2;
        const y = H - h;
        const fill = runColor(run);
        return (
          <g key={run.id || i}>
            <title>
              {`${absoluteTime(run.startedAt)} · ${run.status}${run.isManual ? ' (manual)' : ''} · ${formatDuration(run.durationMs)}`}
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
  const isErr = run.status === 'failed';
  return (
    <div className="grid grid-cols-[12px_1fr_auto_auto] items-center gap-3 px-[14px] py-[10px] bg-surface border border-solid border-line rounded-card">
      <span aria-hidden className="w-2 h-2 rounded-full" style={{
        background: runColor(run),
      }} />
      <div className="min-w-0">
        <div className="font-[family-name:var(--font-body)] text-[13px] font-medium text-ink overflow-hidden text-ellipsis whitespace-nowrap" title={absoluteTime(run.startedAt)}>
          {absoluteTime(run.startedAt) || '—'}
          {run.isManual && <span className="ml-2 px-[6px] py-[1px] rounded-[4px] text-accent text-[10.5px] font-semibold" style={{
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          }}>MANUAL</span>}
        </div>
        {isErr && run.error && (
          <div className="font-[family-name:var(--font-body)] text-[11.5px] text-danger mt-[2px] overflow-hidden text-ellipsis whitespace-nowrap" title={run.error}>{run.error}</div>
        )}
      </div>
      <span className="font-[family-name:var(--font-body)] text-[11.5px] text-ink-3 whitespace-nowrap">{formatDuration(run.durationMs)}</span>
      {run.conversationId ? (
        <Button onClick={() => onOpen?.(run)}>Open task</Button>
      ) : <span />}
    </div>
  );
}


// ── view ──

export default function ScheduleDetailView({
  task,
  projects = [],
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const taskId = task?.id;

  useEffect(() => {
    if (!taskId) return;
    setLoadingRuns(true);
    fetchScheduleRuns(taskId, { limit: 100 })
      .then((data) => setRuns(Array.isArray(data?.runs) ? data.runs : []))
      .catch(() => setRuns([]))
      .finally(() => setLoadingRuns(false));
  }, [taskId, task?.lastRunAt, task?.running]);  // refresh when a run starts or reaches a terminal state

  const stats = useMemo(() => {
    if (!runs.length) return { total: 0, success: 0, error: 0, rate: null, avgMs: null };
    const terminalRuns = runs.filter((r) => r.status !== 'running');
    const success = terminalRuns.filter((r) => r.status === 'success').length;
    const errored = terminalRuns.filter((r) => r.status === 'failed').length;
    const durations = terminalRuns.map((r) => r.durationMs).filter((v) => Number.isFinite(v) && v > 0);
    const avgMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;
    return {
      total:   runs.length,
      success, error: errored,
      rate: terminalRuns.length ? success / terminalRuns.length : null,
      avgMs,
    };
  }, [runs]);

  if (!task) {
    return (
      <div className="scroll-clean flex-1 flex items-center justify-center">
        <div className="font-[family-name:var(--font-body)] text-ink-3">
          Schedule not found.{' '}
          <button onClick={onBack} className="bg-transparent border-0 text-accent cursor-pointer">Back to scheduled tasks</button>
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

  // Resolve the project name from the stored id (ENG-1255) — the schedule
  // response keys the project by id (a UUID), not a name.
  const projectName = projects.find((p) => p.id === task.projectId)?.name || '';

  return (
    <div className="scroll-clean flex-1 overflow-y-auto flex flex-col font-[family-name:var(--font-body)]">
      <PageHeader
        crumbs={[{ label: 'Scheduled Tasks', onClick: onBack, title: 'All scheduled tasks' }]}
        current={task.title || 'Untitled schedule'}
      />

      <div className="sched-body pt-[6px] px-[28px] pb-6 flex flex-col gap-4">

        {error && (
          <Alert variant="danger">{error}</Alert>
        )}

        {/* Hero card — title, status, run-now, enable toggle, next-run */}
        <div className="sched-hero py-[18px] px-[22px] bg-surface border border-solid border-line rounded-card flex flex-col gap-[14px]">
          <div className="sched-hero-top flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="s-h2 text-ink line-clamp-2">{task.title}</div>
              <div className="flex items-center gap-[10px] mt-2">
                <ScheduleStatusBadge task={task} failedLabel="Last run failed" size="lg" dot />
                <span className="font-[family-name:var(--font-body)] text-[12px] text-ink-3">
                  {task.cadence === 'once' ? 'One-off run' : `Runs ${task.cadence}`}
                </span>
              </div>
            </div>
            <div className="sched-hero-actions inline-flex items-center gap-[10px] shrink-0">
              <EnableToggle
                enabled={task.enabled}
                busy={busy}
                onChange={(next) => withBusy(async () => {
                  if (next) await onResume?.(task.id);
                  else      await onPause?.(task.id);
                })}
              />
              <Button
                variant="primary"
                onClick={() => withBusy(() => onRunNow?.(task.id))}
                disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {Ico.send ? Ico.send(13) : null}
                {busy ? 'Running…' : 'Run now'}
              </Button>
              {/* Edit + Delete live in the overflow — Delete opens a confirm,
                  and never sits inside the edit form (ENG-1245). */}
              <OverflowMenu
                disabled={busy}
                // Ghost icon button sized to the neighbouring "Run now" (32px)
                // so the overflow reads as a real, hittable control — not a
                // bare kebab — while staying lighter than the primary action.
                icon={Ico.moreVert(16)}
                triggerClassName="h-8 w-8 justify-center rounded-lg hover:bg-surface-2"
                items={[
                  { id: 'edit', label: 'Edit', icon: Ico.edit ? Ico.edit(14) : null, onClick: () => setEditOpen(true) },
                  { separator: true },
                  { id: 'delete', label: 'Delete', icon: Ico.trash ? Ico.trash(14) : null, danger: true, onClick: () => setConfirmDeleteOpen(true) },
                ]}
              />
            </div>
          </div>

          {/* Prompt preview. */}
          {task.prompt && (
            <div className="px-[14px] py-3 bg-surface-2 border border-solid border-line rounded-card-row font-[family-name:var(--font-body)] text-[13px] text-ink-2 leading-[1.55] whitespace-pre-wrap max-h-[168px] overflow-y-auto">{task.prompt}</div>
          )}

          {/* Next + last run summary. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[14px]">
            <SummaryStat
              label="Next run"
              value={task.enabled ? (relativeTime(task.nextRunAt) ?? '—') : 'Paused'}
              hint={absoluteTime(task.nextRunAt)}
            />
            <SummaryStat
              label="Last run"
              value={task.lastRunAt ? (relativeTime(task.lastRunAt) ?? '—') : '—'}
              hint={absoluteTime(task.lastRunAt)}
            />
            <SummaryStat
              label="Project"
              value={projectName || '—'}
              hint={projectName}
            />
            <SummaryStat
              label="Model"
              value={task.model || 'default'}
            />
          </div>
        </div>

        {/* Health card. */}
        <div className="sched-health py-[18px] px-[22px] bg-surface border border-solid border-line rounded-card flex flex-col gap-[14px]">
          <div className="sched-health-top flex items-start justify-between gap-3">
            <div>
              <div className="font-[family-name:var(--font-display)] text-base font-semibold text-ink">Health</div>
              <div className="font-[family-name:var(--font-body)] text-[12px] text-ink-3 mt-[2px]">Last {Math.min(stats.total, 30)} runs · success rate, duration, error frequency.</div>
            </div>
            <div className="sched-health-metrics inline-flex items-center gap-[14px]">
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
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-[2px] py-1">
            <div className="font-[family-name:var(--font-display)] text-base font-semibold text-ink">
              Recent runs
              <span className="ml-2 font-medium text-ink-4 text-[12px]">{runs.length}</span>
            </div>
            {loadingRuns && (
              <span className="text-[12px] text-ink-4">Loading…</span>
            )}
          </div>
          {runs.length === 0 && !loadingRuns ? (
            <div className="p-[18px] rounded-card border border-dashed border-line-2 text-ink-4 text-center text-sm">No runs yet. Click <strong>Run now</strong> to fire a manual one.</div>
          ) : (
            runs.map((run) => (
              <RunRow
                key={run.id || run.startedAt}
                run={run}
                onOpen={() => run.conversationId && onOpenRunSession?.(run.conversationId)}
              />
            ))
          )}
        </div>
      </div>

      <ScheduleTaskModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={async (payload, id) => onUpdate?.(id, payload)}
        task={task}
        projects={projects}
        agentLabel={agentLabel}
      />

      <ConfirmModal
        open={confirmDeleteOpen}
        title="Delete scheduled task?"
        message={`"${task.title || 'Untitled schedule'}" will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        busy={busy}
        busyLabel="Deleting…"
        onConfirm={() => withBusy(async () => {
          await onDelete?.(task.id);
          // Close on success rather than relying on the host to unmount this
          // view via navigation (onDelete → setRoute); if a future onDelete
          // resolves without navigating away, the modal still dismisses and
          // can't linger over an already-deleted task.
          setConfirmDeleteOpen(false);
        })}
        onClose={() => { if (!busy) setConfirmDeleteOpen(false); }}
      />
    </div>
  );
}


function SummaryStat({ label, value, hint }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-[family-name:var(--font-body)] text-xs font-semibold text-ink-3 tracking-[0.04em] uppercase">{label}</div>
      <div title={hint || undefined} className="font-[family-name:var(--font-display)] text-[16px] font-semibold text-ink tracking-[0] overflow-hidden text-ellipsis whitespace-nowrap">{value}</div>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div className="text-right">
      <div className="font-[family-name:var(--font-body)] text-xs text-ink-4 tracking-[0.04em] uppercase font-semibold">{label}</div>
      <div className="font-[family-name:var(--font-display)] text-[18px] font-semibold tracking-[0] mt-[2px]" style={{
        color: color || 'var(--ink)',
      }}>{value}</div>
    </div>
  );
}
