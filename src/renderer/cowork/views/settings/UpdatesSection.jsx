import { useState, useEffect } from 'react';
import Ico from '../../components/Icons';
import { Button } from '../../components/ui';
import { copyText as copyToClipboard } from '../../lib/clipboard';
import { fetchHealth } from '../../api';
import { host, getVersionInfo, isElectron } from '../../../platform/host';
import { unifiedVersion, SKEW_WARN_DAYS } from '../../../../shared/version';
import { shellAutoOwnsBanner } from '../../../../shared/update-banner';
import { Section, SettingsSectionPanel } from './settingsLayout';

const UPDATE_CARD_CLASS =
  'flex items-center gap-3 flex-wrap py-2.5 px-3 border border-solid ' +
  'border-[color-mix(in_srgb,var(--sage-500)_30%,transparent)] bg-[color-mix(in_srgb,var(--sage-500)_12%,transparent)] rounded-lg';
const UPDATE_CARD_BODY_CLASS = 'flex flex-col gap-0.5 flex-1 min-w-[160px]';

// Naming the ring makes an rc Server version self-explanatory in bug reports:
// staging-ring builds (preview/stable) follow the pre-release server stream.
const BUILD_KIND_LABELS = {
  dev: 'dev (local source)',
  preview: 'preview (staging update ring)',
  stable: 'stable (staging update ring)',
  prod: 'prod',
};

export default function UpdatesSection({
  footer,
  serverOnline = false,
  shellUpdate = null,
  onDownloadShellUpdate,
  shellAutoUpdate = null,
  onDownloadShellAutoUpdate,
  onInstallShellAutoUpdate,
  onRetryShellAutoUpdate,
}) {
  const [versionInfo, setVersionInfo] = useState({ app: '', ui: null, source: 'web', buildKind: null });
  const [serverVersion, setServerVersion] = useState('');
  const [antonVersion, setAntonVersion] = useState('');
  const [showVersionDetails, setShowVersionDetails] = useState(false);
  // 'idle' | 'copied' | 'failed' — 'failed' surfaces feedback when the
  // clipboard helper's fallback chain (see lib/clipboard.js) also fails,
  // instead of leaving the button looking like it silently did nothing.
  const [versionCopyState, setVersionCopyState] = useState('idle');
  // ENG-671 — on-demand "Check for updates". `checkResult` is null (idle) or a
  // summary { ok, offline, updateAvailable, uiUpdateAvailable,
  // serverUpdateAvailable, uiVersion?, serverVersion? } from host.checkForUpdates().
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  // Set when applyUpdate() resolves false — a normal, expected failure path
  // (failed download, compatibility rejection, update disappeared between
  // check and apply), distinct from the thrown-exception case below.
  const [applyError, setApplyError] = useState(false);
  // Browser installer downloads have no completion signal. Track the requested version so newer
  // notices do
  // not inherit download guidance for an earlier version.
  const [shellDownloadedVersion, setShellDownloadedVersion] = useState(null);

  useEffect(() => { getVersionInfo().then(setVersionInfo).catch(() => { }); }, []);
  // Reload health versions when the backend comes online so a cold-open Updates section does not
  // stay blank.
  useEffect(() => {
    if (!serverOnline) return undefined;
    let cancelled = false;
    fetchHealth().then((h) => {
      if (cancelled) return;
      setServerVersion(h?.server_version || '');
      setAntonVersion(h?.anton_version || '');
    }).catch(() => { });
    return () => { cancelled = true; };
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

  const handleApplyUpdateNow = async () => {
    if (applyingUpdate) return;
    setApplyingUpdate(true);
    setApplyError(false);
    const applied = await host.applyUpdate().catch(() => false);
    // Success reloads the window; a resolved false or throw returns to retry.
    setApplyingUpdate(applied);
    setApplyError(!applied);
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
            // App shell = installed Electron shell (changes only on reinstall).
            const shellVer = versionInfo.app || baked;
            // Prefer the running renderer’s baked version; main-process cache metadata can lag OTA,
            // rollback, or bundled execution.
            const uiVer = baked || versionInfo.ui || '';
            const uiSource = versionInfo.source === 'ota' ? 'OTA'
              : versionInfo.source === 'web' ? 'web' : 'bundled';
            // Unified "content" headline = release week of the newest of the
            // hot-updated components (UI + server + agent). App shell is
            // excluded — it updates via reinstall and is shown on its own line.
            const unified = unifiedVersion([uiVer, serverVersion, antonVersion]);
            const outOfSync = !!unified && unified.skewDays >= SKEW_WARN_DAYS;
            const buildLabel = BUILD_KIND_LABELS[versionInfo.buildKind];
            const rows = [
              ['App shell', shellVer || '—'],
              ...(buildLabel ? [['Build', buildLabel]] : []),
              ['UI', uiVer ? `${uiVer} (${uiSource})` : '—'],
              ['Server', serverVersion || '—'],
              ['Agent', antonVersion || '—'],
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
                  <span className="font-[family-name:var(--font-mono)] text-ink-3 text-[12px]">
                    <span className="mr-1">App shell</span>{shellVer || '—'}
                  </span>
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
                    {/*
 * Announce copy-result label changes through a live region; focus alone does not guarantee
 * screen-reader announcement.
 */}
                    <span role="status" aria-live="polite" className="self-start">
                      <Button
                        onClick={async () => {
                          const ok = await copyToClipboard(copyText);
                          if (ok) {
                            setVersionCopyState('copied');
                            setTimeout(() => setVersionCopyState('idle'), 1500);
                          } else {
                            // Keep errors until retry, blur, or panel dismissal so users have time
                            // to read them.
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
              const shellPending = r?.ok ? !!r.shellUpdateAvailable : !!shellUpdate;
              const shellVersion = r?.shellVersion || shellUpdate?.version;
              const shellUrl = r?.shellDownloadUrl || shellUpdate?.downloadUrl;
              const shellDownloadStarted = shellPending && !!shellVersion && shellDownloadedVersion === shellVersion;
              // Auto-update (electron-updater) drives the primary card. The
              // manual installer-download card only surfaces as a fallback when
              // auto-update isn't running or has failed (ENG-850).
              const autoPhase = shellAutoUpdate?.phase;
              const autoVisible = !!autoPhase && !['disabled', 'idle', 'complete'].includes(autoPhase);
              const manualFallback = shellPending && (!autoVisible || autoPhase === 'failed');
              let status = null;
              if (!checkingUpdates && r) {
                if (!r.ok) {
                  status = r.offline
                    ? "Couldn't check — you appear to be offline."
                    : "Couldn't check for updates. Please try again.";
                } else if (!r.updateAvailable) {
                  status = "You're up to date.";
                }
              }
              const isError = !!r && !r.ok;
              const isUpToDate = !checkingUpdates && !!r && r.ok && !r.updateAvailable;
              // Share the banner’s shell-update ownership rule. Only a real shell target suppresses
              // OTA Restart;
              // check-only failures must leave valid UI/server updates visible.
              const shellSurface = (shellAutoUpdate ? shellAutoOwnsBanner(shellAutoUpdate) : false) || manualFallback;
              const applyAvailable = !checkingUpdates && !!r && r.ok && !shellSurface && (r.uiUpdateAvailable || r.serverUpdateAvailable);
              const busy = checkingUpdates || applyingUpdate;
              const parts = [];
              if (applyAvailable) {
                if (r.serverUpdateAvailable) {
                  // Label anton-only updates Agent; absent component means the historical
                  // cowork-server default.
                  const serverLabel = r.serverComponent === 'anton-agent' ? 'Agent' : 'Server';
                  parts.push(`${serverLabel} → ${r.serverVersion || 'new version'}`);
                }
                if (r.uiUpdateAvailable) parts.push(`UI → ${r.uiVersion || 'new version'}`);
              }
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
                  {applyAvailable && (
                    <div className={UPDATE_CARD_CLASS}>
                      <div className={UPDATE_CARD_BODY_CLASS}>
                        <span className="text-sm font-semibold text-ink">Update ready</span>
                        <span className="text-[11.5px] text-ink-3">
                          Restart the app to apply it{parts.length > 0 ? ` (${parts.join(', ')})` : ''}.
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        onClick={handleApplyUpdateNow}
                        disabled={applyingUpdate}
                        style={{ cursor: applyingUpdate ? 'default' : 'pointer', opacity: applyingUpdate ? 0.7 : 1 }}
                      >
                        {applyingUpdate ? 'Restarting…' : applyError ? 'Try again' : 'Restart now'}
                      </Button>
                    </div>
                  )}
                  {autoVisible && (
                    <div className={UPDATE_CARD_CLASS}>
                      <div className={UPDATE_CARD_BODY_CLASS}>
                        <span className="text-sm font-semibold text-ink">
                          {autoPhase === 'checking'
                            ? 'Checking for an app update…'
                            : autoPhase === 'available'
                              ? 'New app version available'
                              : autoPhase === 'downloading'
                                ? `Downloading app update${shellAutoUpdate.progress?.percent != null ? ` — ${Math.round(shellAutoUpdate.progress.percent)}%` : '…'}`
                                : autoPhase === 'ready-to-install'
                                  ? 'App update ready'
                                  : autoPhase === 'installing'
                                    ? 'Installing app update…'
                                    : 'App update failed'}
                        </span>
                        <span className={`text-[11.5px] ${autoPhase === 'failed' ? 'text-warning' : 'text-ink-3'}`}>
                          {autoPhase === 'ready-to-install'
                            ? 'Restart Cowork to finish installing the downloaded update.'
                            : autoPhase === 'failed'
                              ? (shellAutoUpdate.errorMessage || 'The automatic update could not be completed. Your current installation is still usable.')
                              : autoPhase === 'available'
                                ? (shellAutoUpdate.mode === 'manual' ? 'Download it when you are ready.' : 'The update is ready to download.')
                                : 'You can continue working while Cowork prepares the update.'}
                        </span>
                      </div>
                      {autoPhase === 'available' && (
                        <Button variant="primary" onClick={onDownloadShellAutoUpdate}>Download update</Button>
                      )}
                      {autoPhase === 'ready-to-install' && (
                        <Button variant="primary" onClick={onInstallShellAutoUpdate}>Restart now</Button>
                      )}
                      {autoPhase === 'failed' && shellAutoUpdate.recoverable && (
                        <Button variant="primary" onClick={onRetryShellAutoUpdate}>Retry</Button>
                      )}
                    </div>
                  )}
                  {manualFallback && (
                    <div className={UPDATE_CARD_CLASS}>
                      <div className={UPDATE_CARD_BODY_CLASS}>
                        <span className="text-sm font-semibold text-ink">
                          {shellVersion ? `New app version ${shellVersion}` : 'New app version available'}
                        </span>
                        <span className="text-[11.5px] text-ink-3">
                          {autoPhase === 'failed'
                            ? 'You can still download the installer manually.'
                            : shellDownloadStarted
                              ? "Installer downloading — when it's done, quit MindsHub Cowork and open the installer to finish updating."
                              : "Download the installer, then quit MindsHub Cowork and open it to finish updating."}
                        </span>
                      </div>
                      <Button
                        variant={shellDownloadStarted ? 'subtle' : 'primary'}
                        onClick={() => { onDownloadShellUpdate(shellUrl); if (shellVersion) setShellDownloadedVersion(shellVersion); }}
                                              >
                        {shellDownloadStarted ? 'Download again' : 'Download installer'}
                      </Button>
                    </div>
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
