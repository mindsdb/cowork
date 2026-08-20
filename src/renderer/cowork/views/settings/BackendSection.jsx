import { useState, useEffect } from 'react';
import Ico from '../../components/Icons';
import { Alert, Button, Collapsible, Input, Tooltip } from '../../components/ui';
import { host } from '../../../platform/host';
import { backendFailureCopy, exitCodeLabel } from '../../../../shared/server-status';
import { Section, SettingsSectionPanel } from './settingsLayout';

// Port / Exit / Started chips in the status card.
const CHIP_CLASS = 'py-1.5 px-2.5 rounded-md bg-surface-2 border border-solid border-line';
const CHIP_LABEL_CLASS = 'text-ink-4 uppercase tracking-[0.06em] text-[9.5px] mr-1.5';

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

  // Custom (remote) server config — see main/custom-server.ts. `saved` is
  // the persisted config (drives whether the local Status card/footer show
  // at all); the url/token fields below are the draft being edited.
  const [customServer, setCustomServerState] = useState(null);
  const [customUrl, setCustomUrl] = useState('');
  const [customToken, setCustomToken] = useState('');
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  // Load diagnostics + custom server config when the section mounts.
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
    (async () => {
      try {
        const config = await host.getCustomServer();
        if (cancelled) return;
        setCustomServerState(config);
        setCustomUrl(config?.url || '');
        setCustomToken(config?.token || '');
      } catch {
        if (!cancelled) setCustomServerState({ url: null, token: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSaveCustomServer = async () => {
    setCustomBusy(true);
    setCustomError(null);
    try {
      const url = customUrl.trim();
      const ok = await host.setCustomServer({ url: url || null, token: customToken.trim() || null });
      if (ok) {
        setCustomServerState({ url: url || null, token: customToken.trim() || null });
        setNeedsRestart(true);
      } else {
        setCustomError("Couldn't save — check the app's logs and try again.");
      }
    } finally {
      setCustomBusy(false);
    }
  };

  const handleUseLocalServer = async () => {
    setCustomBusy(true);
    setCustomError(null);
    try {
      const ok = await host.setCustomServer({ url: null, token: null });
      if (ok) {
        setCustomUrl('');
        setCustomToken('');
        setCustomServerState({ url: null, token: null });
        setNeedsRestart(true);
      } else {
        setCustomError("Couldn't clear the custom server — check the app's logs and try again.");
      }
    } finally {
      setCustomBusy(false);
    }
  };

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
        <div className="py-8 px-0 flex flex-col items-center justify-center gap-2.5 text-center text-ink-3 text-[13px]">
          <span className="text-[32px] leading-none">☁</span>
          <div className="font-semibold text-ink text-base">Backend is managed server-side</div>
          <div className="max-w-[320px]">The Python backend runs on the server — it isn't controllable from this interface.</div>
        </div>
      </SettingsSectionPanel>
    );
  }

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
      <Tooltip content="Refresh diagnostics">
        <Button onClick={refreshDiag}>
          {Ico.refresh(14)}Refresh
        </Button>
      </Tooltip>
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

  // A custom server is one this app didn't spawn — its start/stop/restart
  // and diagnostics/log tail only ever meant "the local process main
  // manages", so they're replaced entirely rather than left inert.
  const isCustomServer = !!customServer?.url;

  const restartBanner = needsRestart && (
    <Alert variant="warning">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="flex-1">Saved. Restart the app to connect using this configuration.</span>
        <Button variant="primary" onClick={() => host.restartApp()}>Restart now</Button>
      </div>
    </Alert>
  );

  const customServerFields = (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-ink-3" htmlFor="custom-server-url">Server URL</label>
        <Input
          id="custom-server-url"
          value={customUrl}
          onChange={setCustomUrl}
          placeholder="http://192.168.1.5:26866"
          aria-label="Server URL"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-ink-3" htmlFor="custom-server-token">Bearer token</label>
        <Input
          id="custom-server-token"
          type="password"
          value={customToken}
          onChange={setCustomToken}
          placeholder="Leave blank if that server has no auth"
          aria-label="Bearer token"
        />
      </div>
      {customError && <Alert variant="danger">{customError}</Alert>}
    </div>
  );

  if (isCustomServer) {
    return (
      <SettingsSectionPanel
        footer={(
          <>
            <Button onClick={handleUseLocalServer} disabled={customBusy}>
              {customBusy ? 'Switching…' : 'Use local server instead'}
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveCustomServer}
              disabled={customBusy || !customUrl.trim()}
            >{customBusy ? 'Saving…' : 'Save'}</Button>
          </>
        )}
      >
        <div className="flex flex-col gap-[14px]">
          {restartBanner}
          <div className="text-[12px] text-ink-3 leading-[1.5]">
            This app is pointed at a server it didn't spawn — the local backend's
            own status, log, and start/stop controls don't apply here.
          </div>
          {customServerFields}
        </div>
      </SettingsSectionPanel>
    );
  }

  return (
    <SettingsSectionPanel footer={backendFooter}>
      <div className="flex flex-col gap-[14px]">
        {restartBanner}

        {/* Status card — status header + port + logs */}
        <div className="border border-solid border-line rounded-card bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] overflow-hidden">
          <div className="py-2.5 px-4 border-b border-x-0 border-t-0 border-solid border-line text-[10.5px] font-semibold tracking-[0.07em] uppercase text-ink-4">Status</div>

          {/* Status summary row */}
          <div className="flex items-start gap-3 py-[14px] px-4">
            <span
              className="inline-grid place-items-center w-[34px] h-[34px] rounded-lg shrink-0 border border-solid"
              style={{
                background: `color-mix(in srgb, ${STATUS_META.iconBgMix} 14%, var(--surface))`,
                color: STATUS_META.iconColor,
                borderColor: `color-mix(in srgb, ${STATUS_META.iconBgMix} 35%, transparent)`,
              }}
            >
              {Ico.power ? Ico.power(16) : '⏻'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13.5px] text-ink">{STATUS_META.title}</div>
              <div className="text-[12px] text-ink-3 mt-0.5 leading-[1.5]">{STATUS_META.subtitle}</div>
            </div>
          </div>

          {/* Port + exit code + last attempt chips */}
          <div className="flex gap-2 pt-0 px-4 pb-[14px] font-[family-name:var(--font-mono)] text-xs">
            <div className={CHIP_CLASS}>
              <span className={CHIP_LABEL_CLASS}>Port</span>
              <span className="text-ink">{port ?? '—'}</span>
            </div>
            {state === 'offline' && (
              <div className={CHIP_CLASS}>
                <span className={CHIP_LABEL_CLASS}>Exit</span>
                <span className="text-ink">{exitLabel}</span>
              </div>
            )}
            {startedAt && (
              <div className={CHIP_CLASS}>
                <span className={CHIP_LABEL_CLASS}>Started</span>
                <span className="text-ink">{startedAt}</span>
              </div>
            )}
          </div>

          {/* Headline error inside card — offline + start-failure */}
          {state === 'offline' && offlineKind === 'failed' && (
            <div className="pt-0 px-4 pb-[14px]">
              {error ? (
                <Alert variant="danger" className="font-[family-name:var(--font-mono)] break-words">{error}</Alert>
              ) : (
                <div className="py-2.5 px-3 rounded-lg bg-surface-2 border border-solid border-line text-ink-3 text-sm leading-[1.5]">No specific start error was captured. Check the log tail — the process may have died after starting.</div>
              )}
            </div>
          )}

          {/* Recent log */}
          <div className="border-t border-x-0 border-b-0 border-solid border-line pt-2.5 px-4 pb-[14px]">
            <div className="font-[family-name:var(--font-mono)] text-2xs text-ink-4 tracking-[0.1em] uppercase mb-1.5">Log</div>
            {/* ENG-1320: grow to fill the modal instead of a fixed 200px cap
                that squeezed a long log into a tiny scroller while the panel
                had room to spare. Viewport-relative so it scales with the
                modal (min(820px, 88vh)); still capped + scrollable so a very
                long log can't push the section controls off-screen. */}
            <pre className="m-0 py-2.5 px-3 bg-surface-2 border border-solid border-line rounded-lg font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.55] text-ink-2 max-h-[min(520px,52vh)] overflow-auto whitespace-pre-wrap break-words select-text">{log || '(no log captured yet)'}</pre>
          </div>
        </div>

        {/* What actually happened + what to do about it. Driven by the
            failure kind, so the panel never asks for a log in the state
            where no log can exist. */}
        {state === 'offline' && offlineKind === 'failed' && (
          <div className="text-[12px] text-ink-3 leading-[1.5]">
            <div className="text-ink-2 font-semibold mb-1">{failureCopy.headline}</div>
            <ul className="m-0 pl-[18px] flex flex-col gap-[3px]">
              {failureCopy.hints.map((hint) => <li key={hint}>{hint}</li>)}
            </ul>
          </div>
        )}

        {/* Advanced: point this app at a server it didn't spawn instead of
            the local one above. Collapsed by default — most people never
            touch this. */}
        <Collapsible title="Advanced: Custom Server">
          <div className="flex flex-col gap-2.5">
            <div className="text-[12px] text-ink-3 leading-[1.5]">
              Point this app at a cowork-server instance running elsewhere,
              instead of the one this app manages locally. Requires a restart
              to take effect.
            </div>
            {customServerFields}
            <div>
              <Button
                variant="primary"
                onClick={handleSaveCustomServer}
                disabled={customBusy || !customUrl.trim()}
              >{customBusy ? 'Saving…' : 'Save & Restart'}</Button>
            </div>
          </div>
        </Collapsible>
      </div>
    </SettingsSectionPanel>
  );
}
