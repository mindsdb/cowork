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
        <div className="flex flex-col items-center justify-center gap-[10px] py-[32px] text-center text-[13px] text-[var(--text-muted)]">
          <span className="text-[32px] leading-none">☁</span>
          <div className="text-[14px] font-semibold text-[var(--text-strong)]">Backend is managed server-side</div>
          <div className="max-w-[320px]">The Python backend runs on the server — it isn't controllable from this interface.</div>
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
      <div className="flex flex-col gap-[14px]">

        {/* Status card — status header + port + logs */}
        <div className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-[var(--surface-glass)] [backdrop-filter:blur(var(--surface-glass-blur))] [-webkit-backdrop-filter:blur(var(--surface-glass-blur))]">
          <div className="border-b border-line px-[16px] py-[10px] text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-4">Status</div>

          {/* Status summary row */}
          <div className="flex items-start gap-[12px] px-[16px] py-[14px]">
            <span className="inline-grid shrink-0 place-items-center w-[34px] h-[34px] rounded-[8px]" style={{
              background: `color-mix(in srgb, ${STATUS_META.iconBgMix} 14%, var(--surface))`,
              color: STATUS_META.iconColor,
              border: `1px solid color-mix(in srgb, ${STATUS_META.iconBgMix} 35%, transparent)`,
            }}>
              {Ico.power ? Ico.power(16) : '⏻'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold text-ink">{STATUS_META.title}</div>
              <div className="mt-[2px] text-[12px] leading-[1.5] text-ink-3">{STATUS_META.subtitle}</div>
            </div>
          </div>

          {/* Port + exit code + last attempt chips */}
          <div className="flex gap-[8px] px-[16px] pb-[14px] font-mono text-[11px]">
            <div className="rounded-[6px] border border-line bg-surface-2 px-[10px] py-[6px]">
              <span className="mr-[6px] text-[9.5px] uppercase tracking-[0.06em] text-ink-4">Port</span>
              <span className="text-ink">{port ?? '—'}</span>
            </div>
            {state === 'offline' && (
              <div className="rounded-[6px] border border-line bg-surface-2 px-[10px] py-[6px]">
                <span className="mr-[6px] text-[9.5px] uppercase tracking-[0.06em] text-ink-4">Exit</span>
                <span className="text-ink">{exitLabel}</span>
              </div>
            )}
            {startedAt && (
              <div className="rounded-[6px] border border-line bg-surface-2 px-[10px] py-[6px]">
                <span className="mr-[6px] text-[9.5px] uppercase tracking-[0.06em] text-ink-4">Started</span>
                <span className="text-ink">{startedAt}</span>
              </div>
            )}
          </div>

          {/* Headline error inside card — offline + start-failure */}
          {state === 'offline' && offlineKind === 'failed' && (
            <div className="px-[16px] pb-[14px]">
              {error ? (
                <Alert variant="danger" style={{ fontFamily: FONT_MONO, wordBreak: 'break-word' }}>{error}</Alert>
              ) : (
                <div className="rounded-[8px] border border-line bg-surface-2 px-[12px] py-[10px] text-[12.5px] leading-[1.5] text-ink-3">No specific start error was captured. Check the log tail — the process may have died after starting.</div>
              )}
            </div>
          )}

          {/* Recent log */}
          <div className="border-t border-line px-[16px] pt-[10px] pb-[14px]">
            <div className="mb-[6px] font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Log</div>
            {/* ENG-1320: grow to fill the modal instead of a fixed 200px cap
                that squeezed a long log into a tiny scroller while the panel
                had room to spare. Viewport-relative so it scales with the
                modal (min(820px, 88vh)); still capped + scrollable so a very
                long log can't push the section controls off-screen. */}
            <pre className="m-0 max-h-[min(520px,52vh)] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-line bg-surface-2 px-[12px] py-[10px] font-mono text-[11.5px] leading-[1.55] text-ink-2 select-text">{log || '(no log captured yet)'}</pre>
          </div>
        </div>

        {/* What actually happened + what to do about it. Driven by the
            failure kind, so the panel never asks for a log in the state
            where no log can exist. */}
        {state === 'offline' && offlineKind === 'failed' && (
          <div className="text-[12px] leading-[1.5] text-ink-3">
            <div className="mb-[4px] font-semibold text-ink-2">{failureCopy.headline}</div>
            <ul className="m-0 flex flex-col gap-[3px] pl-[18px]">
              {failureCopy.hints.map((hint) => <li key={hint}>{hint}</li>)}
            </ul>
          </div>
        )}


      </div>
    </SettingsSectionPanel>
  );
}
