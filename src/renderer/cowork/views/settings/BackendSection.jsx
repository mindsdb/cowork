import { useState, useEffect } from 'react';
import Ico from '../../components/Icons';
import { Alert, Button } from '../../components/ui';
import { host } from '../../../platform/host';
import { backendFailureCopy, exitCodeLabel } from '../../../../shared/server-status';
import { Section, SettingsSectionPanel } from './settingsLayout';

// The Backend settings section: local Python server status, diagnostics, and
// start/stop/restart controls. Electron-only — unreachable from the nav since
// ENG-932 (navItemsForHost drops it on web), kept as a defensive fallback.
// Owns its diagnostics state; server lifecycle is driven through the
// onStartServer / onStopServer props.
export default function BackendSection({
  serverOnline = false,
  serverBusy = false,
  serverBusyKind = 'starting',
  onStartServer,
  onStopServer,
}) {
  const [diag, setDiag] = useState(null);
  const [diagBusy, setDiagBusy] = useState(false);

  // Load diagnostics when the section mounts.
  useEffect(() => {
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
  }, []);

  const refreshDiag = async () => {
    try {
      const data = await host.serverDiagnostics();
      setDiag(data || null);
    } catch { }
  };

  const handleBackendStart = async () => {
    if (!onStartServer) return;
    setDiagBusy(true);
    try {
      await onStartServer();
      await refreshDiag();
    } finally {
      setDiagBusy(false);
    }
  };

  const handleBackendStop = async () => {
    if (!onStopServer) return;
    setDiagBusy(true);
    try {
      await onStopServer();
      await refreshDiag();
    } finally {
      setDiagBusy(false);
    }
  };

  const handleBackendRestart = async () => {
    setDiagBusy(true);
    try {
      if (onStopServer && onStartServer) {
        await onStopServer();
        await onStartServer();
      }
      await refreshDiag();
    } finally {
      setDiagBusy(false);
    }
  };

  // Unreachable from the nav since ENG-932 — `navItemsForHost` drops Backend
  // on web, and `effectiveSection` refuses to resolve to a section the host
  // doesn't offer. Kept as a defensive fallback for any future caller that
  // renders a section directly rather than through the nav.
  if (host.isWeb) {
    return (
      <SettingsSectionPanel>
        <div style={{
          padding: '32px 0',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 13,
        }}>
          <span style={{ fontSize: 32, lineHeight: 1 }}>☁</span>
          <div style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 14 }}>Backend is managed server-side</div>
          <div style={{ maxWidth: 320 }}>The Python backend runs on the server — it isn't controllable from this interface.</div>
        </div>
      </SettingsSectionPanel>
    );
  }

  const FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";
  const error = diag?.lastError;
  const log = (diag?.recentLog || '').trim();
  const port = diag?.port;
  const errorKind = diag?.lastErrorKind ?? null;
  const startedAt = diag?.lastStartAt
    ? new Date(diag.lastStartAt).toLocaleTimeString()
    : null;
  // "never started" is wrong for a backend that was still importing when we
  // stopped waiting for it (the most common failure on a slow machine's first
  // launch), and equally wrong for one the user deliberately stopped — a
  // signal kill leaves no exit code, so both used to land on that string.
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

  const state = serverBusy
    ? (serverBusyKind === 'stopping' ? 'stopping' : 'starting')
    : serverOnline ? 'online' : 'offline';
  const offlineKind = state === 'offline'
    && !error
    && diag?.lastStopIntentional === true
    ? 'stopped'
    : 'failed';

  const STATUS_META = {
    online: { title: 'MindsHub backend is running', subtitle: 'The local Python server is responding to /health.', iconColor: 'var(--success)', iconBgMix: 'var(--success)' },
    starting: { title: 'MindsHub backend is starting…', subtitle: 'Spawning the local Python server. This usually takes a few seconds.', iconColor: 'var(--accent)', iconBgMix: 'var(--accent)' },
    stopping: { title: 'MindsHub backend is stopping…', subtitle: 'Waiting for the local Python server to terminate.', iconColor: 'var(--ink-3)', iconBgMix: 'var(--ink-3)' },
    offline: offlineKind === 'stopped'
      ? { title: 'MindsHub backend is stopped', subtitle: 'You stopped the local Python server. Click "Start backend" below to bring it back up.', iconColor: 'var(--ink-3)', iconBgMix: 'var(--ink-3)' }
      : { title: 'MindsHub backend isn\'t running', subtitle: "The local Python server didn't start. The most recent error and log tail are captured below.", iconColor: 'var(--danger)', iconBgMix: 'var(--danger)' },
  }[state];

  const backendFooter = (
    <>
      <Button onClick={refreshDiag} title="Refresh diagnostics">
        {Ico.refresh(14)}Refresh
      </Button>
      {(onStartServer || onStopServer) && state !== 'offline' && (
        <Button onClick={handleBackendStop} disabled={diagBusy || serverBusy || !onStopServer}>
          {(diagBusy && serverBusyKind === 'stopping') ? 'Stopping…' : 'Stop backend'}
        </Button>
      )}
      {(onStartServer || onStopServer) && (
        <Button variant="primary" onClick={state === 'offline' ? handleBackendStart : handleBackendRestart}
          disabled={diagBusy || serverBusy || (state === 'offline' ? !onStartServer : !(onStartServer && onStopServer))}
        >{diagBusy ? (state === 'offline' ? 'Starting…' : 'Restarting…') : (state === 'offline' ? 'Start backend' : 'Restart backend')}</Button>
      )}
    </>
  );

  return (
    <SettingsSectionPanel footer={backendFooter}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Status card — status header + port + logs */}
        <div style={{
          border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)',
          background: 'var(--surface-glass)',
          WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
          backdropFilter: 'blur(var(--surface-glass-blur))',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--line)',
            fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: 'var(--ink-4)',
          }}>Status</div>

          {/* Status summary row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px' }}>
            <span style={{
              display: 'inline-grid', placeItems: 'center',
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              background: `color-mix(in srgb, ${STATUS_META.iconBgMix} 14%, var(--surface))`,
              color: STATUS_META.iconColor,
              border: `1px solid color-mix(in srgb, ${STATUS_META.iconBgMix} 35%, transparent)`,
            }}>
              {Ico.power ? Ico.power(16) : '⏻'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{STATUS_META.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>{STATUS_META.subtitle}</div>
            </div>
          </div>

          {/* Port + exit code + last attempt chips */}
          <div style={{
            display: 'flex', gap: 8, padding: '0 16px 14px',
            fontFamily: FONT_MONO, fontSize: 11,
          }}>
            <div style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <span style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9.5, marginRight: 6 }}>Port</span>
              <span style={{ color: 'var(--ink)' }}>{port ?? '—'}</span>
            </div>
            {state === 'offline' && (
              <div style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9.5, marginRight: 6 }}>Exit</span>
                <span style={{ color: 'var(--ink)' }}>{exitLabel}</span>
              </div>
            )}
            {startedAt && (
              <div style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9.5, marginRight: 6 }}>Started</span>
                <span style={{ color: 'var(--ink)' }}>{startedAt}</span>
              </div>
            )}
          </div>

          {/* Headline error inside card — offline + start-failure */}
          {state === 'offline' && offlineKind === 'failed' && (
            <div style={{ padding: '0 16px 14px' }}>
              {error ? (
                <Alert variant="danger" style={{ fontFamily: FONT_MONO, wordBreak: 'break-word' }}>{error}</Alert>
              ) : (
                <div style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: 'var(--surface-2)', border: '1px solid var(--line)',
                  color: 'var(--ink-3)', fontSize: 12.5, lineHeight: 1.5,
                }}>No specific start error was captured. Check the log tail — the process may have died after starting.</div>
              )}
            </div>
          )}

          {/* Recent log */}
          <div style={{ borderTop: '1px solid var(--line)', padding: '10px 16px 14px' }}>
            <div style={{
              fontFamily: FONT_MONO, fontSize: 10, color: 'var(--ink-4)',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6,
            }}>Log</div>
            {/* ENG-1320: grow to fill the modal instead of a fixed 200px cap
                that squeezed a long log into a tiny scroller while the panel
                had room to spare. Viewport-relative so it scales with the
                modal (min(820px, 88vh)); still capped + scrollable so a very
                long log can't push the section controls off-screen. */}
            <pre style={{
              margin: 0, padding: '10px 12px',
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              borderRadius: 8, fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.55,
              color: 'var(--ink-2)', maxHeight: 'min(520px, 52vh)', overflow: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text',
            }}>{log || '(no log captured yet)'}</pre>
          </div>
        </div>

        {/* What actually happened + what to do about it. Driven by the
            failure kind, so the panel never asks for a log in the state
            where no log can exist. */}
        {state === 'offline' && offlineKind === 'failed' && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            <div style={{ color: 'var(--ink-2)', fontWeight: 600, marginBottom: 4 }}>{failureCopy.headline}</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {failureCopy.hints.map((hint) => <li key={hint}>{hint}</li>)}
            </ul>
          </div>
        )}


      </div>
    </SettingsSectionPanel>
  );
}
