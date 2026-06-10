// Backend state modal — opened by clicking the sidebar's status pill.
// Reflects the live server state in its header (running / starting /
// stopping / offline) and shows the diagnostics block (port, last
// start time, log tail). Exit code + offline-specific causes / hints
// only surface when the backend isn't currently up.

import { useEffect, useState } from 'react';
import Ico from './Icons';
import { host } from '../../platform/host';

const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";

export default function ServerOfflineHelpModal({
  open,
  onClose,
  // Atomic server actions wired from App.jsx. The modal composes
  // "Restart" locally from `onStop` + `onStart` so the parent only
  // needs to expose the two primitives. Older callers passed a
  // single `onRetry` that did stop+start; that hid the "I just want
  // to stop, not restart" intent and made it impossible to give the
  // user a Stop button. Kept here for backwards-compat — when neither
  // `onStop` nor `onStart` is provided, `onRetry` runs the legacy
  // stop+start cycle.
  onStart,
  onStop,
  onRetry,
  serverOnline = false,
  serverBusy = false,
  serverBusyKind = 'starting',
  agentLabel,
}) {
  const [diag, setDiag] = useState(null);
  const [busy, setBusy] = useState(false);

  // Pull diagnostics fresh on each open — the recentLog only grows
  // while the python process is running, so we want the latest tail
  // every time the user clicks the icon.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await host.serverDiagnostics();
        if (!cancelled) setDiag(data || null);
      } catch {
        if (!cancelled) setDiag(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const error = diag?.lastError;
  const log = (diag?.recentLog || '').trim();
  const port = diag?.port;
  const exitCode = diag?.lastExitCode;
  const startedAt = diag?.lastStartAt
    ? new Date(diag.lastStartAt).toLocaleTimeString()
    : null;

  // Live state → title + header colour + subtitle. The same modal is
  // used in every state — clicking the status pill while the backend
  // is up should read as "Backend status" not "Backend isn't running".
  //
  // The offline branch splits further. Three signals are involved:
  //   - `lastError`: present when a start attempt failed (timeout,
  //     spawn error, deps missing, …). Absent after a successful
  //     start, even if the python later crashed.
  //   - `lastStopIntentional`: TRUE when the death was caused by a
  //     user/app stopServer() call; FALSE on crash; NULL pre-first-
  //     stop. This is the load-bearing signal — `lastError` alone
  //     can't distinguish a clean stop from a post-start crash since
  //     both leave it null.
  // Decision: stopped panel iff there's no start-time error AND the
  // last transition was intentional. Everything else (including the
  // initial "never tried" state and post-start crashes) gets the
  // failure panel.
  const state = serverBusy
    ? (serverBusyKind === 'stopping' ? 'stopping' : 'starting')
    : serverOnline ? 'online' : 'offline';
  const offlineKind = state === 'offline'
    && !error
    && diag?.lastStopIntentional === true
    ? 'stopped'
    : 'failed';
  const HEADER = {
    online:   {
      title:    `${agentLabel || 'Anton'} backend is running`,
      subtitle: `Live on port ${port ?? '—'}. The local Python server is responding to /health.`,
      iconColor:  'var(--success, #1F8F5F)',
      iconBgMix:  'var(--success, #1F8F5F)',
    },
    starting: {
      title:    `${agentLabel || 'Anton'} backend is starting…`,
      subtitle: 'Spawning the local Python server. This usually takes a few seconds — the modal will reflect the result automatically.',
      iconColor:  'var(--accent)',
      iconBgMix:  'var(--accent)',
    },
    stopping: {
      title:    `${agentLabel || 'Anton'} backend is stopping…`,
      subtitle: 'Waiting for the local Python server to terminate.',
      iconColor:  'var(--ink-3)',
      iconBgMix:  'var(--ink-3)',
    },
    offline: offlineKind === 'stopped'
      ? {
          title:    `${agentLabel || 'Anton'} backend is stopped`,
          subtitle: 'You stopped the local Python server. Click "Start backend" below to bring it back up.',
          iconColor:  'var(--ink-3)',
          iconBgMix:  'var(--ink-3)',
        }
      : {
          title:    `${agentLabel || 'Anton'} backend isn't running`,
          subtitle: "The local Python server didn't start. Below is the most recent error and log tail captured from the process.",
          iconColor:  'var(--danger)',
          iconBgMix:  'var(--danger)',
        },
  }[state];

  const refreshDiag = async () => {
    try {
      const data = await host.serverDiagnostics();
      setDiag(data || null);
    } catch {}
  };

  const handleStart = async () => {
    if (!onStart) return;
    setBusy(true);
    try {
      await onStart();
      await refreshDiag();
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (!onStop) return;
    setBusy(true);
    try {
      await onStop();
      await refreshDiag();
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    setBusy(true);
    try {
      // Prefer atomic actions when wired; fall back to the legacy
      // single onRetry handler so older callers still work.
      if (onStop && onStart) {
        await onStop();
        await onStart();
      } else if (onRetry) {
        await onRetry();
      }
      await refreshDiag();
    } finally {
      setBusy(false);
    }
  };

  // Legacy single-button click target — only used when atomic
  // handlers aren't provided. Kept as a thin wrapper so the existing
  // disabled-while-busy + diagnostics-refresh logic is unchanged for
  // any caller that still ships the old API.
  const handleRetry = async () => {
    setBusy(true);
    try {
      await onRetry?.();
      // Pull fresh diagnostics after the retry attempt — gives the
      // user immediate feedback on whether the new attempt worked.
      const data = await host.serverDiagnostics();
      setDiag(data || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: 'min(640px, 88vh)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(15,16,17,0.30)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: FONT_BODY,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '16px 18px',
          borderBottom: '1px solid var(--line)',
        }}>
          <span style={{
            display: 'inline-grid', placeItems: 'center',
            width: 36, height: 36, borderRadius: 8,
            background: `color-mix(in srgb, ${HEADER.iconBgMix} 14%, var(--surface))`,
            color: HEADER.iconColor, flexShrink: 0,
            border: `1px solid color-mix(in srgb, ${HEADER.iconBgMix} 35%, transparent)`,
          }}>
            {Ico.power(18)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 600, fontSize: 14.5, color: 'var(--ink)',
            }}>{HEADER.title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
              {HEADER.subtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              cursor: 'pointer',
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              width: 28, height: 28, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              fontSize: 18, lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 18px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {/* Quick facts row — exit code only renders when the
              backend isn't running, otherwise it's irrelevant noise.
              The grid auto-fits whichever tiles are present. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${state === 'offline' ? 3 : 2}, minmax(0, 1fr))`,
            gap: 10,
            fontFamily: FONT_MONO, fontSize: 11,
          }}>
            <div style={{
              padding: '8px 10px', borderRadius: 7,
              background: 'var(--surface-2)', border: '1px solid var(--line)',
            }}>
              <div style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>Port</div>
              <div style={{ color: 'var(--ink)', marginTop: 2 }}>{port ?? '—'}</div>
            </div>
            {state === 'offline' && (
              <div style={{
                padding: '8px 10px', borderRadius: 7,
                background: 'var(--surface-2)', border: '1px solid var(--line)',
              }}>
                <div style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>Exit code</div>
                <div style={{ color: 'var(--ink)', marginTop: 2 }}>{exitCode ?? 'never started'}</div>
              </div>
            )}
            <div style={{
              padding: '8px 10px', borderRadius: 7,
              background: 'var(--surface-2)', border: '1px solid var(--line)',
            }}>
              <div style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>Last attempt</div>
              <div style={{ color: 'var(--ink)', marginTop: 2 }}>{startedAt ?? '—'}</div>
            </div>
          </div>

          {/* Headline error — offline + start-failure only. A
              user-initiated stop has no failure to surface, so we
              skip the error block entirely; the header subtitle
              already explains why the backend is down. */}
          {state === 'offline' && offlineKind === 'failed' && (error ? (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
              color: 'var(--danger)', fontSize: 13, lineHeight: 1.5,
              fontFamily: FONT_MONO,
              wordBreak: 'break-word',
            }}>{error}</div>
          ) : (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.5,
            }}>
              No specific start error was captured. Check the log tail below — the python process may have died after a successful start.
            </div>
          ))}

          {/* Recent log */}
          <div>
            <div style={{
              fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              marginBottom: 6,
            }}>Recent log</div>
            <pre style={{
              margin: 0,
              padding: '10px 12px',
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.55,
              color: 'var(--ink-2)',
              maxHeight: 280,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'text',
            }}>{log || '(no log captured yet)'}</pre>
          </div>

          {state === 'offline' && (
            <div style={{
              fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5,
            }}>
              Common causes: a stale process holding port {port ?? 26866}, a missing Python interpreter (re-run the installer), or a crash in a route handler. Restart the backend below — if it keeps failing, copy the log and share it for support.
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 8,
          padding: '12px 18px',
          borderTop: '1px solid var(--line)',
          background: 'var(--surface)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--line)',
              color: 'var(--ink-2)',
              padding: '7px 14px', borderRadius: 7,
              fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
            }}
          >Close</button>
          {/* Action buttons — split by intent so the user can stop
              the backend without it immediately restarting:
                * online   → [Stop] [Restart]   (Restart = stop + start)
                * offline  → [Start]
              All disabled while a transition is in flight so we
              don't fire concurrent toggles into the main process.
              Falls back to a single legacy button when only the
              old `onRetry` API was provided. */}
          {(onStart || onStop) ? (
            <>
              {state !== 'offline' && (
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={busy || serverBusy || !onStop}
                  style={{
                    cursor: (busy || serverBusy) ? 'progress' : 'pointer',
                    background: 'transparent',
                    border: '1px solid var(--line)',
                    color: 'var(--ink-2)',
                    padding: '7px 14px', borderRadius: 7,
                    fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
                    opacity: (busy || serverBusy) ? 0.7 : 1,
                  }}
                >
                  {(busy && serverBusyKind === 'stopping') ? 'Stopping…' : 'Stop backend'}
                </button>
              )}
              <button
                type="button"
                onClick={state === 'offline' ? handleStart : handleRestart}
                disabled={busy || serverBusy || (state === 'offline' ? !onStart : !(onStart && onStop))}
                style={{
                  cursor: (busy || serverBusy) ? 'progress' : 'pointer',
                  background: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  color: '#fff',
                  padding: '7px 14px', borderRadius: 7,
                  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600,
                  opacity: (busy || serverBusy) ? 0.7 : 1,
                }}
              >
                {busy
                  ? (state === 'offline' ? 'Starting…' : 'Restarting…')
                  : (state === 'offline' ? 'Start backend' : 'Restart backend')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleRetry}
              disabled={busy || serverBusy}
              style={{
                cursor: (busy || serverBusy) ? 'progress' : 'pointer',
                background: 'var(--accent)',
                border: '1px solid var(--accent)',
                color: '#fff',
                padding: '7px 14px', borderRadius: 7,
                fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600,
                opacity: (busy || serverBusy) ? 0.7 : 1,
              }}
            >
              {busy
                ? (state === 'offline' ? 'Starting…' : 'Restarting…')
                : (state === 'offline' ? 'Start backend' : 'Restart backend')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
