import { useEffect, useState } from 'react';
import Ico from './Icons';
import { Alert, Button, Tooltip } from './ui';
import { Modal } from './ui/Modal';
import { host } from '../../platform/host';
import { backendFailureCopy, exitCodeLabel } from '../../../shared/server-status';

const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";

export default function ServerOfflineHelpModal({
  open,
  onClose,
  // Restart composes onStop and onStart. Callers without either handler retain the legacy onRetry
  // stop/start flow.
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

  // Refresh diagnostics on open to show the latest log tail.
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


  const error = diag?.lastError;
  const log = (diag?.recentLog || '').trim();
  const port = diag?.port;
  const errorKind = diag?.lastErrorKind ?? null;
  const startedAt = diag?.lastStartAt
    ? new Date(diag.lastStartAt).toLocaleTimeString()
    : null;
  // A missing exit code can mean startup timed out or the server was deliberately stopped; it does
  // not prove startup never began.
  const exitLabel = exitCodeLabel({
    kind: errorKind,
    exitCode: diag?.lastExitCode ?? null,
    stopIntentional: diag?.lastStopIntentional ?? null,
  });
  const failureCopy = backendFailureCopy({
    kind: errorKind,
    hasLog: log.length > 0,
    port: port ?? null,
    portHolderPid: diag?.portHolderPid ?? null,
  });

  // lastError clears after successful startup, so it cannot distinguish a later crash from a clean
  // stop. Show the stopped panel
  // only for an intentional stop without a startup error; crashes and the initial unattempted state
  // use the failure panel.
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

  const handleRetry = async () => {
    setBusy(true);
    try {
      await onRetry?.();
      const data = await host.serverDiagnostics();
      setDiag(data || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      width="min(640px, 92vw)"
      maxHeight="min(640px, 88vh)"
      ariaLabel={HEADER.title}
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
          <Tooltip content="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                cursor: 'pointer',
                background: 'transparent', border: 0,
                color: 'var(--ink-3)',
                width: 28, height: 28, borderRadius: 6,
                display: 'inline-grid', placeItems: 'center',
                fontSize: 18, lineHeight: 1, flexShrink: 0,
              }}
            >×</button>
          </Tooltip>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 18px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
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
                <div style={{ color: 'var(--ink)', marginTop: 2 }}>{exitLabel}</div>
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

          {/* An intentional stop has no failure to display. */}
          {state === 'offline' && offlineKind === 'failed' && (error ? (
            <Alert variant="danger" style={{ fontFamily: FONT_MONO, wordBreak: 'break-word' }}>{error}</Alert>
          ) : (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.5,
            }}>
              No specific start error was captured. Check the log tail below — the python process may have died after a successful start.
            </div>
          ))}

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

          {state === 'offline' && offlineKind === 'failed' && (
            <div style={{
              fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5,
            }}>
              <div style={{ color: 'var(--ink-2)', fontWeight: 600, marginBottom: 4 }}>{failureCopy.headline}</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {failureCopy.hints.map((hint) => <li key={hint}>{hint}</li>)}
              </ul>
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
          <Button
            variant="subtle"
            onClick={onClose}
          >Close</Button>
          {/*
 * Disable actions during transitions to prevent concurrent server toggles; support onRetry-only
 * callers.
 */}
          {(onStart || onStop) ? (
            <>
              {state !== 'offline' && (
                <Button
                  onClick={handleStop}
                  disabled={busy || serverBusy || !onStop}
                >
                  {(busy && serverBusyKind === 'stopping') ? 'Stopping…' : 'Stop backend'}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={state === 'offline' ? handleStart : handleRestart}
                disabled={busy || serverBusy || (state === 'offline' ? !onStart : !(onStart && onStop))}
              >
                {busy
                  ? (state === 'offline' ? 'Starting…' : 'Restarting…')
                  : (state === 'offline' ? 'Start backend' : 'Restart backend')}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={handleRetry}
              disabled={busy || serverBusy}
            >
              {busy
                ? (state === 'offline' ? 'Starting…' : 'Restarting…')
                : (state === 'offline' ? 'Start backend' : 'Restart backend')}
            </Button>
          )}
        </div>
    </Modal>
  );
}
