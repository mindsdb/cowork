// Backend state modal — opened by clicking the sidebar's status pill.
// Reflects the live server state in its header (running / starting /
// stopping / offline) and shows the diagnostics block (port, last
// start time, log tail). Exit code + offline-specific causes / hints
// only surface when the backend isn't currently up.

import { useEffect, useState } from 'react';
import Ico from './Icons';

const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";

export default function ServerOfflineHelpModal({
  open,
  onClose,
  onRetry,
  serverOnline = false,
  serverBusy = false,
  serverBusyKind = 'starting',
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
        const data = await window.antontron?.serverDiagnostics?.();
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
  const state = serverBusy
    ? (serverBusyKind === 'stopping' ? 'stopping' : 'starting')
    : serverOnline ? 'online' : 'offline';
  const HEADER = {
    online:   {
      title:    'Anton backend is running',
      subtitle: `Live on port ${port ?? '—'}. The local Python server is responding to /health.`,
      iconColor:  'var(--success, #1F8F5F)',
      iconBgMix:  'var(--success, #1F8F5F)',
    },
    starting: {
      title:    'Anton backend is starting…',
      subtitle: 'Spawning the local Python server. This usually takes a few seconds — the modal will reflect the result automatically.',
      iconColor:  'var(--accent)',
      iconBgMix:  'var(--accent)',
    },
    stopping: {
      title:    'Anton backend is stopping…',
      subtitle: 'Waiting for the local Python server to terminate.',
      iconColor:  'var(--ink-3)',
      iconBgMix:  'var(--ink-3)',
    },
    offline: {
      title:    "Anton backend isn't running",
      subtitle: "The local Python server didn't start. Below is the most recent error and log tail captured from the process.",
      iconColor:  'var(--danger)',
      iconBgMix:  'var(--danger)',
    },
  }[state];

  const handleRetry = async () => {
    setBusy(true);
    try {
      await onRetry?.();
      // Pull fresh diagnostics after the retry attempt — gives the
      // user immediate feedback on whether the new attempt worked.
      const data = await window.antontron?.serverDiagnostics?.();
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

          {/* Headline error — offline only. While running there's no
              "start error" to surface; the log tail below is enough
              for live debugging. */}
          {state === 'offline' && (error ? (
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
          {/* Restart is available in every state — even when the
              backend reports "online" some kinds of corruption (a
              cached ChatSession pointing at a deleted project dir,
              etc.) only clear after a full restart. Disabled while
              starting/stopping so we don't fire concurrent toggles
              into the main process. */}
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
        </div>
      </div>
    </div>
  );
}
