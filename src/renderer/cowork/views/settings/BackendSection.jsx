import { useState, useEffect } from 'react';
import Ico from '../../components/Icons';
import { Alert, Button, Checkbox, Input, Tooltip } from '../../components/ui';
import { host } from '../../../platform/host';
import { backendFailureCopy, exitCodeLabel } from '../../../../shared/server-status';
import { Section, SettingsSectionPanel } from './settingsLayout';

// Fixed-width placeholder for a saved key. The renderer never receives the
// key itself (main only reports whether one exists), so there is no real
// length to mirror.
const MASK = '•'.repeat(12);

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

  // Custom (remote) server config — see main/custom-server.ts. `customServer`
  // is the persisted { url, hasToken } summary (drives whether the local
  // Status card/footer show at all); the url/token fields below are the draft
  // being edited. The saved key never comes back from main: a blank token
  // field on save means "keep it" unless the user asked to remove it.
  const [customServer, setCustomServerState] = useState(null);
  const [customUrl, setCustomUrl] = useState('');
  const [customToken, setCustomToken] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [editingServer, setEditingServer] = useState(false);

  // Local server auth (see main/local-auth.ts) — off by default. `enabled`
  // drives the checkbox; `hasToken` only whether to render the masked chip.
  const [localAuth, setLocalAuthState] = useState(null);
  const [localAuthBusy, setLocalAuthBusy] = useState(false);

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
      } catch {
        if (!cancelled) setCustomServerState({ url: null, hasToken: false });
      }
    })();
    (async () => {
      try {
        const config = await host.getLocalAuth();
        if (!cancelled) setLocalAuthState(config);
      } catch {
        if (!cancelled) setLocalAuthState({ enabled: false, hasToken: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleToggleLocalAuth = async (checked) => {
    setLocalAuthBusy(true);
    try {
      const result = await host.setLocalAuth(checked);
      if (result.ok) {
        setLocalAuthState({ enabled: result.enabled, hasToken: result.hasToken });
        await refreshDiag();
      }
    } finally {
      setLocalAuthBusy(false);
    }
  };

  const handleSaveCustomServer = async () => {
    setCustomBusy(true);
    setCustomError(null);
    try {
      const url = customUrl.trim();
      const token = customToken.trim();
      const keepExistingToken = !token && !clearKey && !!customServer?.hasToken;
      const result = await host.setCustomServer({ url: url || null, token: token || null, keepExistingToken });
      if (result?.ok) {
        setCustomServerState({ url: url || null, hasToken: !!url && (!!token || keepExistingToken) });
        setCustomToken('');
        setClearKey(false);
        setNeedsRestart(true);
        setEditingServer(false);
      } else {
        setCustomError(result?.error || "Couldn't save — check the app's logs and try again.");
      }
    } finally {
      setCustomBusy(false);
    }
  };

  // Discard the draft and drop back to whatever's actually saved — clearing
  // the URL field and saving is how a custom server gets un-set, so there's
  // no separate "use local server" action to maintain.
  const handleCancelEditServer = () => {
    setCustomUrl(customServer?.url || '');
    setCustomToken('');
    setClearKey(false);
    setCustomError(null);
    setEditingServer(false);
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
  const displayUrl = customServer?.url || (port ? `http://127.0.0.1:${port}` : null);
  const maskedKey = customServer?.hasToken ? MASK : null;
  const localMaskedKey = localAuth?.hasToken ? MASK : null;

  const restartBanner = needsRestart && (
    <Alert variant="warning">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="flex-1">Saved. Restart the app to connect using this configuration.</span>
        <Button variant="primary" onClick={() => host.restartApp()}>Restart now</Button>
      </div>
    </Alert>
  );

  // Server (port's already part of the URL) / key live in one line, with
  // Edit at the end of it — a toggle swaps that line for the editable
  // fields in place.
  const connectionRow = editingServer ? (
    <div className="flex flex-col gap-2.5 py-[14px] px-4 border-b border-x-0 border-t-0 border-solid border-line">
      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-ink-3" htmlFor="custom-server-url">Server URL</label>
        <Input
          id="custom-server-url"
          value={customUrl}
          onChange={setCustomUrl}
          placeholder="http://192.168.1.5:26866 (leave blank for the local server)"
          aria-label="Server URL"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-ink-3" htmlFor="custom-server-token">API key</label>
        <Input
          id="custom-server-token"
          type="password"
          value={customToken}
          onChange={setCustomToken}
          placeholder={customServer?.hasToken && !clearKey ? 'Saved key kept — type to replace it' : 'Leave blank if that server has no auth'}
          aria-label="API key"
        />
        {customServer?.hasToken && (
          <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
            {clearKey ? (
              <>
                <span>The saved key will be removed on save.</span>
                <Button size="xs" variant="subtle" onClick={() => setClearKey(false)}>Keep it</Button>
              </>
            ) : (
              <Button size="xs" variant="subtle" onClick={() => setClearKey(true)}>Remove saved key</Button>
            )}
          </div>
        )}
      </div>
      {customError && <Alert variant="danger">{customError}</Alert>}
      <div className="flex items-center gap-2 justify-end">
        <Button size="sm" onClick={handleCancelEditServer} disabled={customBusy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={handleSaveCustomServer} disabled={customBusy}>
          {customBusy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex items-center gap-2 flex-wrap py-[14px] px-4 border-b border-x-0 border-t-0 border-solid border-line font-[family-name:var(--font-mono)] text-xs">
      <div className={CHIP_CLASS}>
        <span className={CHIP_LABEL_CLASS}>Server</span>
        <span className="text-ink">{displayUrl || '—'}</span>
      </div>
      {isCustomServer ? (
        <div className={CHIP_CLASS}>
          <span className={CHIP_LABEL_CLASS}>Key</span>
          <span className="text-ink">{maskedKey || '—'}</span>
        </div>
      ) : (
        <Tooltip content="Require a bearer token for every local API request, so a page in another browser tab can't reach this server.">
          <div className={`${CHIP_CLASS} flex items-center gap-1.5`}>
            {/* The masked key sits OUTSIDE the <label> so it never becomes
                part of the checkbox's accessible name (Base UI points
                aria-labelledby at the wrapping label, which wins over any
                aria-label) — the name stays "Enable auth key" whether or
                not a key is currently set. */}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox
                size="sm"
                checked={!!localAuth?.enabled}
                onCheckedChange={handleToggleLocalAuth}
                disabled={localAuthBusy || localAuth === null}
              />
              <span className={CHIP_LABEL_CLASS}>{localAuthBusy ? 'Applying…' : 'Enable auth key'}</span>
            </label>
            {localAuth?.enabled && <span className="text-ink">{localMaskedKey}</span>}
          </div>
        </Tooltip>
      )}
      <Button
        variant="subtle"
        size="xs"
        className="ml-auto"
        onClick={() => setEditingServer(true)}
        aria-label="Edit server settings"
      >
        {Ico.edit ? Ico.edit(12) : '✎'}Edit
      </Button>
    </div>
  );

  return (
    <SettingsSectionPanel footer={isCustomServer ? null : backendFooter}>
      <div className="flex flex-col gap-[14px]">
        {restartBanner}

        {/* Status card — connection info up top, local status/port/logs below */}
        <div className="border border-solid border-line rounded-card bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] overflow-hidden">
          <div className="py-2.5 px-4 border-b border-x-0 border-t-0 border-solid border-line text-[10.5px] font-semibold tracking-[0.07em] uppercase text-ink-4">Status</div>

          {isCustomServer ? (
            <div className="py-[14px] px-4 text-[12px] text-ink-3 leading-[1.5]">
              This app is pointed at a server it didn't spawn — the local backend's
              own status, log, and start/stop controls don't apply here. Sign-in
              credentials and connector authorizations from this app aren't forwarded
              either: configure providers and connectors on that server.
            </div>
          ) : (
            /* Status summary row */
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
          )}

          {connectionRow}

          {!isCustomServer && (startedAt || state === 'offline') && (
            <div className="flex gap-3 flex-wrap pt-0 px-4 pb-[14px] text-2xs text-ink-4">
              {startedAt && <span>Started {startedAt}</span>}
              {state === 'offline' && <span>Exit {exitLabel}</span>}
            </div>
          )}

          {!isCustomServer && (
            <>
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

              {/* Recent log. Viewport-relative cap (not a shared-ancestor
                  flex-fill) so this stays self-contained — it must never
                  depend on sizing added to SettingsSectionPanel, which every
                  other settings section also renders through. */}
              <div className="border-t border-x-0 border-b-0 border-solid border-line pt-2.5 px-4 pb-[14px]">
                <div className="font-[family-name:var(--font-mono)] text-2xs text-ink-4 tracking-[0.1em] uppercase mb-1.5">Log</div>
                <pre className="m-0 py-2.5 px-3 bg-surface-2 border border-solid border-line rounded-lg font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.55] text-ink-2 max-h-[min(400px,42vh)] overflow-auto whitespace-pre-wrap break-words select-text">{log || '(no log captured yet)'}</pre>
              </div>
            </>
          )}
        </div>

        {/* What actually happened + what to do about it. Driven by the
            failure kind, so the panel never asks for a log in the state
            where no log can exist. */}
        {!isCustomServer && state === 'offline' && offlineKind === 'failed' && (
          <div className="text-[12px] text-ink-3 leading-[1.5]">
            <div className="text-ink-2 font-semibold mb-1">{failureCopy.headline}</div>
            <ul className="m-0 pl-[18px] flex flex-col gap-[3px]">
              {failureCopy.hints.map((hint) => <li key={hint}>{hint}</li>)}
            </ul>
          </div>
        )}
      </div>
    </SettingsSectionPanel>
  );
}
