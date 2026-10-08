import { useState, useEffect, useRef } from 'react';
import Ico from '../../components/Icons';
import { Alert, Button } from '../../components/ui';
import { copyText as copyToClipboard } from '../../lib/clipboard';
import { fetchHealth } from '../../api';
import { host, getVersionInfo, isElectron } from '../../../platform/host';
import { unifiedVersion, SKEW_WARN_DAYS } from '../../../../shared/version';
import { MIN_SUPPORTED_SHELL, SUPPORTED_SHELL_WINDOW_DAYS } from '../../../../shared/shell-support';
import { deriveUpdateBanner, debInstallStep } from '../../../../shared/update-banner';
import { Section, SettingsSectionPanel } from './settingsLayout';

const UPDATE_CARD_CLASS =
  'flex items-center gap-3 flex-wrap py-2.5 px-3 border border-solid ' +
  'border-[color-mix(in_srgb,var(--sage-500)_30%,transparent)] bg-[color-mix(in_srgb,var(--sage-500)_12%,transparent)] rounded-lg';
const UPDATE_CARD_BODY_CLASS = 'flex flex-col gap-0.5 flex-1 min-w-[160px]';

// How long one /health read may take before the Server and Agent rows say so,
// and how soon the panel tries again (ENG-3291). The bound equals api.js's
// SHORT_REQUEST_TIMEOUT_MS; it is restated here because the Settings tests
// mock that module wholesale.
export const BACKEND_VERSION_TIMEOUT_MS = 10_000;
export const BACKEND_VERSION_RETRY_MS = 5_000;
// What the rows show while no version has answered. Copied into the details
// text as-is, so a bug report says "Server: Unavailable" rather than a dash.
const BACKEND_VERSION_PLACEHOLDER = { loading: 'Loading…', unavailable: 'Unavailable' };

// Naming the ring makes an rc Server version self-explanatory in bug reports:
// staging-ring builds (preview/stable) follow the pre-release server stream.
const BUILD_KIND_LABELS = {
  dev: 'dev (local source)',
  preview: 'preview (staging update ring)',
  stable: 'stable (staging update ring)',
  prod: 'prod',
};

// The Updates settings section: current-version readout plus the on-demand
// update check and the one pending-update card. The card is the same banner
// the sidebar shows (deriveUpdateBanner over the one update state), with the
// same action, so the two surfaces cannot disagree and at most one restart is
// ever offered. The section owns the rest of its state (versions,
// the check result, in-flight flags), so nothing here leaks into the rest of
// SettingsView. The Save `footer` is rendered by the parent and passed through.
export default function UpdatesSection({
  footer,
  serverOnline = false,
  updateState = null,
  onUpdateAction,
}) {
  const [versionInfo, setVersionInfo] = useState({ app: '', ui: null, source: 'web', buildKind: null });
  // Backend (server + agent) versions, read from /health. `state` is
  // 'loading' until the first answer, 'ok' once it has one, 'unavailable' when
  // a read failed or ran past the bound; the rows never show a bare dash for a
  // read that is merely slow or broken (ENG-3291).
  const [backendVersions, setBackendVersions] = useState({ state: 'loading', server: '', anton: '' });
  const serverVersion = backendVersions.server;
  const antonVersion = backendVersions.anton;
  const [showVersionDetails, setShowVersionDetails] = useState(false);
  // 'idle' | 'copied' | 'failed' — 'failed' surfaces feedback when the
  // clipboard helper's fallback chain (see lib/clipboard.js) also fails,
  // instead of leaving the button looking like it silently did nothing.
  const [versionCopyState, setVersionCopyState] = useState('idle');
  // ENG-671 — on-demand "Check for updates". `checkResult` is null (idle) or a
  // summary { ok, offline, updateAvailable, … } from host.checkForUpdates().
  // It drives only the status line: what the check found feeds the one update
  // state, and the card below renders from that.
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  // Set when the apply resolves false — a normal, expected failure path
  // (failed download, compatibility rejection, update disappeared between
  // check and apply), distinct from a thrown exception.
  const [applyError, setApplyError] = useState(false);
  // The shell (installer) download is a hand-off to the browser — we can't
  // detect when it finishes, so once the user triggers it for a given version
  // we flip the card to the quit-and-open guidance. Keyed by version so a newer
  // shell notice later in the session starts fresh instead of showing stale
  // "downloading…" copy for a version that was never fetched.
  const [shellDownloadedVersion, setShellDownloadedVersion] = useState(null);
  // ENG-1047 — is the installed shell inside the supported desktop window? The
  // verdict comes from the same rule as the launch notice (getShellSupport →
  // assessShellSupport), so the two surfaces cannot disagree. Null until it
  // resolves, and on web or whenever a version the rule needs cannot be read,
  // in which case the row shows no verdict at all.
  const [shellSupport, setShellSupport] = useState(null);

  useEffect(() => { getVersionInfo().then(setVersionInfo).catch(() => { }); }, []);
  useEffect(() => {
    let cancelled = false;
    // An OTA renderer can run on a host module that predates getShellSupport
    // only in tests (host.ts ships inside this bundle), but the probe is cheap
    // and matches how every other optional surface here fails closed.
    Promise.resolve()
      .then(() => host.getShellSupport())
      .then((verdict) => { if (!cancelled) setShellSupport(verdict ?? null); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);
  // Backend (server + agent) versions come from /health, which is only
  // reachable when the backend is up. Re-read whenever the section mounts and
  // the backend is online, so versions populate after a cold open or a
  // start/restart from the Backend section instead of staying blank.
  //
  // The read is bounded and retried while the panel is open (ENG-3291). On
  // 6 October one hung request left the rows at a dash for the whole session:
  // the sidecar's connection pool was full, `fetchHealth` has no timeout of
  // its own, and the effect never ran again. Now a read that fails or exceeds
  // the bound marks the rows unavailable and tries again a few seconds later,
  // until one answers.
  useEffect(() => {
    if (!serverOnline) {
      // A stopped backend has no versions to read. Say so, rather than
      // leaving the rows on the initial "Loading…" for as long as it is down.
      setBackendVersions((prev) => ({ ...prev, state: 'unavailable' }));
      return undefined;
    }
    let cancelled = false;
    let retry = null;
    const read = async () => {
      let timer = null;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timeout' }), BACKEND_VERSION_TIMEOUT_MS);
      });
      const health = await Promise.race([
        fetchHealth({ timeoutMs: BACKEND_VERSION_TIMEOUT_MS }).catch(() => null),
        timeout,
      ]);
      clearTimeout(timer);
      if (cancelled) return;
      const server = health?.server_version || '';
      const anton = health?.anton_version || '';
      if (server || anton) {
        setBackendVersions({ state: 'ok', server, anton });
        return;
      }
      setBackendVersions((prev) => ({ ...prev, state: 'unavailable' }));
      retry = setTimeout(read, BACKEND_VERSION_RETRY_MS);
    };
    read();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [serverOnline]);

  const handleCheckForUpdates = async () => {
    if (checkingUpdates || applyingUpdate) return;
    setCheckingUpdates(true);
    setCheckResult(null);
    setApplyError(false);
    try {
      setCheckResult(await host.checkForUpdates());
    } catch {
      setCheckResult({ ok: false, offline: false, updateAvailable: false });
    } finally {
      setCheckingUpdates(false);
    }
  };

  const applyInFlight = useRef(false);
  const handleAction = async (banner) => {
    if (!onUpdateAction || !banner?.action) return;
    if (banner.kind === 'shell-manual') {
      // A hand-off to the browser: there is no end to detect, so the card
      // flips to the quit-and-open guidance for this version at once.
      if (banner.version) setShellDownloadedVersion(banner.version);
      await onUpdateAction(banner.action, { url: updateState?.shell?.manualDownloadUrl });
      return;
    }
    if (applyInFlight.current) return;
    applyInFlight.current = true;
    setApplyError(false);
    // The button reads "Restarting…" only once the restart proceeds, not
    // while the running-tasks dialog is open (ENG-3291).
    const result = await Promise.resolve(onUpdateAction(banner.action, { onProceed: () => setApplyingUpdate(true) })).catch(() => false);
    applyInFlight.current = false;
    // The person chose to keep their running tasks (ENG-3291): not an error,
    // the card simply offers Restart now again.
    if (result === 'cancelled') { setApplyingUpdate(false); return; }
    // Another surface's request is still out (the sidebar's, say): this click
    // did nothing, so the card changes nothing.
    if (result === 'busy') return;
    // A restart that proceeds reloads or relaunches the app; a resolved false
    // (or a throw) returns the card to a retryable state. A retry or download
    // is not a restart, so its button never reads "Restarting…".
    const restart = banner.action === 'reload' || banner.action === 'relaunch';
    setApplyingUpdate(restart && result === true);
    setApplyError(restart && result !== true);
  };

  return (
    <SettingsSectionPanel footer={footer}>
      <div className="border border-solid border-line rounded-card bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] mb-[14px] overflow-hidden pt-0 px-[18px] pb-2">
        <Section
          title="Current version"
          subtitle="The version currently running. Server and UI updates are applied automatically at launch; components under the hood are shown in details."
        >
          {(() => {
            const baked = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
            // App shell = installed Electron shell (changes only when the shell
            // relaunches into a new build — auto-update or reinstall).
            const shellVer = versionInfo.app || baked;
            // The running renderer's own baked version is authoritative for the
            // UI version — it's compiled into whichever bundle actually loaded
            // (OTA or bundled). Main-process cache metadata (`versionInfo.ui`)
            // can lag the loaded renderer (OTA off, missing cache, post-
            // rollback), so it only informs the source label, never the version.
            const uiVer = baked || versionInfo.ui || '';
            const uiSource = versionInfo.source === 'ota' ? 'OTA'
              : versionInfo.source === 'web' ? 'web' : 'bundled';
            // Unified "content" headline = release week of the newest of the
            // hot-updated components (UI + server + agent). App shell is
            // excluded — it only changes on a relaunch, so it is shown on its
            // own line, with the supported-window verdict beside it (ENG-1047).
            const unified = unifiedVersion([uiVer, serverVersion, antonVersion]);
            const outOfSync = !!unified && unified.skewDays >= SKEW_WARN_DAYS;
            const buildLabel = BUILD_KIND_LABELS[versionInfo.buildKind];
            const shellTooOld = shellSupport?.status === 'too-old';
            // Off web the backend rows always say something: a version, or why
            // there is none yet. On web the sidecar is the host, so a missing
            // version there keeps the plain dash.
            const backendPlaceholder = isElectron
              ? (BACKEND_VERSION_PLACEHOLDER[backendVersions.state] || '—')
              : '—';
            const rows = [
              ['App shell', shellTooOld ? `${shellVer} (too old)` : (shellVer || '—')],
              ...(buildLabel ? [['Build', buildLabel]] : []),
              ['UI', uiVer ? `${uiVer} (${uiSource})` : '—'],
              ['Server', serverVersion || backendPlaceholder],
              ['Agent', antonVersion || backendPlaceholder],
            ];
            const copyText = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
            return (
              <div className="flex flex-col gap-2 text-sm text-ink">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span title={unified ? `Release week ${unified.cycleRange}` : undefined} className="font-[family-name:var(--font-mono)] text-md font-semibold">
                    {unified ? unified.label : (shellVer || '—')}
                  </span>
                  {outOfSync && (
                    <span
                      title={`Underlying components span ${unified.skewDays} days — a component is lagging. See details.`}
                      className="text-warning text-[11.5px] font-semibold"
                    >
                      ⚠ out of sync
                    </span>
                  )}
                  {unified && (
                    <span className="text-ink-3 text-[11.5px]">built {unified.buildDate}</span>
                  )}
                </div>
                {isElectron && (
                  <span className="font-[family-name:var(--font-mono)] text-ink-3 text-[12px] flex items-baseline gap-2 flex-wrap">
                    <span><span className="mr-1">App shell</span>{shellVer || '—'}</span>
                    {shellTooOld && (
                      <span
                        title={`Supported: ${MIN_SUPPORTED_SHELL} or newer, and within ${SUPPORTED_SHELL_WINDOW_DAYS} days of the latest app (${shellSupport.latestShellVersion}).`}
                        className="text-warning text-[11.5px] font-semibold font-[family-name:var(--font-sans)]"
                      >
                        ⚠ too old
                      </span>
                    )}
                  </span>
                )}
                {shellTooOld && (
                  <Alert variant="warning" icon={Ico.warning ? Ico.warning(16) : undefined} data-testid="shell-too-old">
                    This app is too old for this version of Cowork. Some features are hidden until the
                    app updates to {shellSupport.latestShellVersion}. Use Software updates below.
                  </Alert>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowVersionDetails((v) => !v);
                    // Hiding the panel unmounts the Copy button below — treat
                    // it like the blur/unmount clear so a stale "Couldn't
                    // copy" isn't waiting the next time details are reopened.
                    setVersionCopyState('idle');
                  }}
                  className="self-start bg-transparent border-none p-0 cursor-pointer text-accent text-[11.5px]"
                >
                  {showVersionDetails ? 'Hide details' : 'Details'}
                </button>
                {showVersionDetails && (
                  <div className="flex flex-col gap-1 font-[family-name:var(--font-mono)] text-[12px] py-2 px-2.5 border border-solid border-line rounded-lg bg-surface-glass">
                    {rows.map(([k, v]) => (
                      <span key={k} className="select-text">
                        <span className="text-ink-3 mr-1.5 inline-block min-w-[64px]">{k}</span>{v}
                      </span>
                    ))}
                    {/* role="status"/aria-live wraps the button itself (unlike
                        ApiKeyInput's separate pill) because the failure text
                        here IS the button's label — without a live region a
                        screen reader has no guarantee it announces a focused
                        button's label changing out from under it. */}
                    <span role="status" aria-live="polite" className="self-start">
                      <Button
                        onClick={async () => {
                          const ok = await copyToClipboard(copyText);
                          if (ok) {
                            setVersionCopyState('copied');
                            setTimeout(() => setVersionCopyState('idle'), 1500);
                          } else {
                            // No auto-clear timer here — same reasoning as the
                            // API-key copy above: an error needs longer than
                            // 1.5s to read. Cleared by the next attempt, blur,
                            // or hiding the panel (onClick above).
                            setVersionCopyState('failed');
                          }
                        }}
                        onBlur={() => { if (versionCopyState === 'failed') setVersionCopyState('idle'); }}
                        className="mt-1"
                      >
                        {versionCopyState === 'copied' ? 'Copied' : versionCopyState === 'failed' ? "Couldn't copy — select the details above to copy manually" : 'Copy'}
                      </Button>
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </Section>
        {isElectron && (
          <Section
            title="Software updates"
            subtitle="UI and server updates apply automatically when the app restarts. A new app version downloads in the background and installs the next time you relaunch."
          >
            {(() => {
              const r = checkResult;
              // Linux ships a .deb, which is installed rather than launched, so
              // the last step of the copy changes.
              const debInstaller = host.getPlatform() === 'linux';
              // The same banner the sidebar shows, from the same state. Settings
              // never filters the manual notice by dismissal.
              const banner = deriveUpdateBanner(updateState, { debInstaller });
              const shell = updateState?.shell;
              const shellDownloadStarted = banner?.kind === 'shell-manual' && !!banner.version && shellDownloadedVersion === banner.version;
              const debStep = `${debInstallStep(banner?.version)}.`;
              let status = null;
              if (!checkingUpdates && r) {
                if (!r.ok) {
                  status = r.offline
                    ? "Couldn't check — you appear to be offline."
                    : "Couldn't check for updates. Please try again.";
                } else if (!r.updateAvailable && !banner) {
                  status = "You're up to date.";
                }
              }
              const isError = !!r && !r.ok;
              const isUpToDate = !checkingUpdates && !!r && r.ok && !r.updateAvailable && !banner;
              const busy = checkingUpdates || applyingUpdate;
              // Which layers the one restart applies, named under the title. A
              // relaunch applies any pending OTA at boot too, so both lists read
              // from the same state.
              const parts = [];
              if (updateState?.server?.status === 'ready') {
                // An anton-only server update (ENG-1094) carries the agent's
                // version in serverVersion — label it "Agent" so the card
                // doesn't call an agent bump a "Server" update.
                parts.push(`${updateState.server.component === 'anton-agent' ? 'Agent' : 'Server'} → ${updateState.server.version || 'new version'}`);
              }
              if (updateState?.ui?.status === 'ready') parts.push(`UI → ${updateState.ui.version || 'new version'}`);
              let body = null;
              let label = banner?.actionLabel ?? null;
              if (banner) {
                switch (banner.kind) {
                  case 'shell-manual':
                    body = shell?.errorCode
                      ? 'You can still download the installer manually.'
                      : shellDownloadStarted
                        ? `Installer downloading — when it's done, quit MindsHub Cowork and ${debInstaller ? debStep : 'open the installer to finish updating.'}`
                        : `Download the installer, then quit MindsHub Cowork and ${debInstaller ? debStep : 'open it to finish updating.'}`;
                    label = shellDownloadStarted ? 'Download again' : 'Download installer';
                    break;
                  case 'ota-error':
                    body = "Couldn't apply the update. Try again to restart.";
                    break;
                  case 'ota-ready':
                    body = `Restart the app to apply it${parts.length > 0 ? ` (${parts.join(', ')})` : ''}.`;
                    break;
                  case 'shell-auto':
                  default:
                    if (banner.action === 'relaunch') {
                      // The last Restart never left the process (ENG-3291): say why,
                      // or the card just reads "ready" again.
                      body = banner.hint && shell?.errorCode
                        ? banner.hint
                        : `Restart Cowork to finish installing the downloaded update${parts.length > 0 ? ` (${parts.join(', ')})` : ''}.`;
                    } else if (banner.action === 'download') {
                      body = shell?.mode === 'manual' ? 'Download it when you are ready.' : 'The update is ready to download.';
                    } else if (banner.tone === 'error') {
                      body = shell?.errorMessage || 'The automatic update could not be completed. Your current installation is still usable.';
                    } else {
                      body = 'You can continue working while Cowork prepares the update.';
                    }
                    break;
                }
                if (banner.action === 'reload' || banner.action === 'relaunch') {
                  label = applyingUpdate ? 'Restarting…' : applyError ? 'Try again' : label;
                }
              }
              const bodyTone = banner?.tone === 'error' ? 'text-warning' : 'text-ink-3';
              return (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      onClick={handleCheckForUpdates}
                      disabled={busy}
                      className="min-w-[150px] inline-flex items-center justify-center gap-1.5"
                      style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}
                    >
                      {checkingUpdates ? 'Checking…' : 'Check for updates'}
                    </Button>
                    {status && (
                      <span className={`text-sm inline-flex items-center gap-1.5 ${isError ? 'text-warning' : 'text-ink-3'}`}>
                        {isUpToDate && Ico.check ? Ico.check(14) : null}
                        {status}
                      </span>
                    )}
                  </div>
                  {banner && (
                    <div className={UPDATE_CARD_CLASS}>
                      <div className={UPDATE_CARD_BODY_CLASS}>
                        <span className="text-sm font-semibold text-ink">{banner.title}</span>
                        {body && <span className={`text-[11.5px] ${bodyTone}`}>{body}</span>}
                      </div>
                      {label && (
                        <Button
                          variant={banner.kind === 'shell-manual' && shellDownloadStarted ? 'subtle' : 'primary'}
                          onClick={() => handleAction(banner)}
                          disabled={banner.disabled || applyingUpdate}
                          style={{ cursor: applyingUpdate ? 'default' : 'pointer', opacity: applyingUpdate ? 0.7 : 1 }}
                        >
                          {label}
                        </Button>
                      )}
                    </div>
                  )}
                  {/* The shell's own passive states, under the card rather than
                      as a second one: a check in flight, or a check that failed
                      with nothing to retry while an OTA restart is offered. */}
                  {shell?.status === 'checking' && (
                    <span className="text-[11.5px] text-ink-3">Checking for an app update…</span>
                  )}
                  {shell?.status === 'failed' && banner?.kind !== 'shell-auto' && !updateState?.silentShellFailure && (
                    <span className="text-[11.5px] text-warning">
                      The last app update check failed{shell.errorMessage ? ` (${shell.errorMessage})` : ''}. It will try again on its own.
                    </span>
                  )}
                  {applyError && (
                    <span className="text-sm text-warning">
                      Couldn't apply the update. Please try again.
                    </span>
                  )}
                </div>
              );
            })()}
          </Section>
        )}
      </div>
    </SettingsSectionPanel>
  );
}
