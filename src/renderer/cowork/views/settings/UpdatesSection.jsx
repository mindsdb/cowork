import { useState, useEffect, useRef } from 'react';
import Ico from '../../components/Icons';
import { Alert, Button } from '../../components/ui';
import { copyText as copyToClipboard } from '../../lib/clipboard';
import { fetchHealth } from '../../api';
import { host, getVersionInfo, isElectron } from '../../../platform/host';
import { unifiedVersion, SKEW_WARN_DAYS } from '../../../../shared/version';
import { versionRows } from '../../lib/versionRows';
import {
  deriveShellOsCappedNotice,
  MIN_MACOS_FOR_LATEST_SHELL,
  MIN_SUPPORTED_SHELL,
  SUPPORTED_SHELL_WINDOW_DAYS,
} from '../../../../shared/shell-support';
import { shellAutoOwnsBanner, debInstallStep, abortedInstallHint } from '../../../../shared/update-banner';
import { Section, SettingsSectionPanel } from './settingsLayout';
import { STOCK_PRODUCT_NAME, STOCK_SHORT_NAME } from '../../../../shared/product-name';
import { productName } from '../../../lib/deploymentBrand';
import { sharedTranslator, useTranslation } from '../../../lib/i18n';

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
// What the rows show while no version has answered (keys under
// updates.backendVersion). Copied into the details text as-is, so a bug report
// says "Server: Unavailable" rather than a dash.
const BACKEND_VERSION_PLACEHOLDER = { loading: 'updates.backendVersion.loading', unavailable: 'updates.backendVersion.unavailable' };

// The Updates settings section: current-version readout plus the on-demand
// update check/apply flow. Self-contained — it owns every piece of state its
// UI needs (versions, the check result, in-flight/applied flags), so nothing
// here leaks into the rest of SettingsView. The Save `footer` is rendered by
// the parent and passed through, and the shell (installer) update hand-off
// comes in via `shellUpdate` / `onDownloadShellUpdate`.
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
  const { t } = useTranslation('settingsSystem');
  const shortName = productName(STOCK_SHORT_NAME);
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
  // summary { ok, offline, updateAvailable, uiUpdateAvailable,
  // serverUpdateAvailable, uiVersion?, serverVersion? } from host.checkForUpdates().
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  // Set when applyUpdate() resolves false — a normal, expected failure path
  // (failed download, compatibility rejection, update disappeared between
  // check and apply), distinct from the thrown-exception case below.
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
  const handleApplyUpdateNow = async () => {
    if (applyInFlight.current) return;
    applyInFlight.current = true;
    setApplyError(false);
    // The button reads "Restarting…" only once the restart proceeds, not
    // while the running-tasks dialog is open (ENG-3291).
    const applied = await host.applyUpdate({ onProceed: () => setApplyingUpdate(true) }).catch(() => false);
    applyInFlight.current = false;
    // The person chose to keep their running tasks (ENG-3291): not an error,
    // the card simply offers Restart now again.
    if (applied === 'cancelled') { setApplyingUpdate(false); return; }
    // Success reloads the window; a resolved false or throw returns to retry.
    setApplyingUpdate(applied);
    setApplyError(!applied);
  };

  return (
    <SettingsSectionPanel footer={footer}>
      <div className="border border-solid border-line rounded-card bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] mb-[14px] overflow-hidden pt-0 px-[18px] pb-2">
        <Section
          title={t('updates.currentVersion.title')}
          subtitle={t('updates.currentVersion.subtitle')}
        >
          {(() => {
            const baked = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
            const shellVer = versionInfo.app || baked;
            // Derived the same way versionRows does it, and for the same
            // reason — see lib/versionRows.js.
            const uiVer = baked || versionInfo.ui || '';
            // Unified "content" headline = release week of the newest of the
            // hot-updated components (UI + server + agent). App shell is
            // excluded — it only changes on a relaunch, so it is shown on its
            // own line, with the supported-window verdict beside it (ENG-1047).
            const unified = unifiedVersion([uiVer, serverVersion, antonVersion]);
            const outOfSync = !!unified && unified.skewDays >= SKEW_WARN_DAYS;
            const shellTooOld = shellSupport?.status === 'too-old';
            const osCappedNotice = deriveShellOsCappedNotice(shellSupport, sharedTranslator('app'));
            // Off web the backend rows always say something: a version, or why
            // there is none yet. On web the sidecar is the host, so a missing
            // version there keeps the plain dash.
            const backendPlaceholder = isElectron
              ? (BACKEND_VERSION_PLACEHOLDER[backendVersions.state] ? t(BACKEND_VERSION_PLACEHOLDER[backendVersions.state]) : '—')
              : '—';
            const rows = versionRows({
              versionInfo, bakedVersion: baked, serverVersion, antonVersion,
              shellTooOld, osCappedMacosMajor: osCappedNotice ? shellSupport.macosMajor : null,
              backendPlaceholder,
            });
            const copyText = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
            return (
              <div className="flex flex-col gap-2 text-sm text-ink">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span title={unified ? t('updates.currentVersion.releaseWeek', { range: unified.cycleRange }) : undefined} className="text-md font-semibold tabular-nums">
                    {unified ? unified.label : (shellVer || '—')}
                  </span>
                  {outOfSync && (
                    <span
                      title={t('updates.currentVersion.outOfSyncHint', { days: unified.skewDays })}
                      className="text-warning text-[11.5px] font-semibold"
                    >
                      {t('updates.currentVersion.outOfSync')}
                    </span>
                  )}
                  {unified && (
                    <span className="text-ink-3 text-[11.5px]">{t('updates.currentVersion.built', { date: unified.buildDate })}</span>
                  )}
                </div>
                {isElectron && (
                  <span className="text-ink-3 text-[12px] flex items-baseline gap-2 flex-wrap">
                    <span><span className="mr-1">{t('updates.currentVersion.appShell')}</span>{shellVer || '—'}</span>
                    {shellTooOld && (
                      <span
                        title={t('updates.currentVersion.tooOldHint', { minVersion: MIN_SUPPORTED_SHELL, days: SUPPORTED_SHELL_WINDOW_DAYS, latestVersion: shellSupport.latestShellVersion })}
                        className="text-warning text-[11.5px] font-semibold"
                      >
                        {t('updates.currentVersion.tooOld')}
                      </span>
                    )}
                    {osCappedNotice && (
                      <span
                        title={t('updates.currentVersion.osCappedHint', { minMacos: MIN_MACOS_FOR_LATEST_SHELL })}
                        className="text-warning text-[11.5px] font-semibold"
                      >
                        {t('updates.currentVersion.osCapped', { macos: shellSupport.macosMajor })}
                      </span>
                    )}
                  </span>
                )}
                {shellTooOld && (
                  <Alert variant="warning" data-testid="shell-too-old">
                    {t('updates.currentVersion.tooOldAlert', { product: shortName, version: shellSupport.latestShellVersion })}
                  </Alert>
                )}
                {osCappedNotice && (
                  <Alert variant="warning" icon={Ico.warning ? Ico.warning(16) : undefined} data-testid="shell-os-capped">
                    <strong>{osCappedNotice.title}.</strong> {osCappedNotice.body}
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
                  {showVersionDetails ? t('updates.currentVersion.hideDetails') : t('updates.currentVersion.showDetails')}
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
                        {versionCopyState === 'copied' ? t('updates.currentVersion.copied') : versionCopyState === 'failed' ? t('updates.currentVersion.copyFailed') : t('updates.currentVersion.copy')}
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
            title={t('updates.software.title')}
            subtitle={t('updates.software.subtitle')}
          >
            {(() => {
              const r = checkResult;
              const shellPending = r?.ok ? !!r.shellUpdateAvailable : !!shellUpdate;
              const shellVersion = r?.shellVersion || shellUpdate?.version;
              const shellUrl = r?.shellDownloadUrl || shellUpdate?.downloadUrl;
              // Linux ships a .deb, which is installed rather than launched, so
              // the last step of the copy changes.
              const debInstaller = host.getPlatform() === 'linux';
              const shellDownloadStarted = shellPending && !!shellVersion && shellDownloadedVersion === shellVersion;
              // Auto-update (electron-updater) drives the primary card. The
              // manual installer-download card only surfaces as a fallback when
              // auto-update isn't running or has failed (ENG-850).
              const autoPhase = shellAutoUpdate?.phase;
              const autoVisible = !!autoPhase && !['disabled', 'idle', 'complete'].includes(autoPhase);
              const manualFallback = shellPending && (!autoVisible || autoPhase === 'failed');
              const debStep = debInstallStep(shellVersion, sharedTranslator('app'));
              const manualHint = autoPhase === 'failed'
                ? t('updates.software.manualAfterFailure')
                : shellDownloadStarted
                  ? (debInstaller
                    ? t('updates.software.installerDownloadingDeb', { product: STOCK_PRODUCT_NAME, step: debStep })
                    : t('updates.software.installerDownloading', { product: STOCK_PRODUCT_NAME }))
                  : (debInstaller
                    ? t('updates.software.downloadInstallerHintDeb', { product: STOCK_PRODUCT_NAME, step: debStep })
                    : t('updates.software.downloadInstallerHint', { product: STOCK_PRODUCT_NAME }));
              let status = null;
              if (!checkingUpdates && r) {
                if (!r.ok) {
                  status = r.offline
                    ? t('updates.software.offline')
                    : t('updates.software.checkFailed');
                } else if (!r.updateAvailable) {
                  status = t('updates.software.upToDate');
                }
              }
              const isError = !!r && !r.ok;
              const isUpToDate = !checkingUpdates && !!r && r.ok && !r.updateAvailable;
              // Shell-first suppression of the redundant OTA "Restart now" card,
              // decided by the SAME rule the sidebar banner uses — reuse
              // shellAutoOwnsBanner so "which shell-auto phase is a pending update
              // (and `failed` only with a real target)" lives in one place and the
              // two surfaces can't drift. A targetless / check-only failure doesn't
              // own the slot, so it never hides a valid UI/server Restart. The
              // manual-notice side stays local because here it's derived from the
              // live check result (shellPending), not the dismissal-filtered prop.
              const shellSurface = (shellAutoUpdate ? shellAutoOwnsBanner(shellAutoUpdate) : false) || manualFallback;
              const applyAvailable = !checkingUpdates && !!r && r.ok && !shellSurface && (r.uiUpdateAvailable || r.serverUpdateAvailable);
              const busy = checkingUpdates || applyingUpdate;
              const parts = [];
              if (applyAvailable) {
                if (r.serverUpdateAvailable) {
                  // An anton-only server update (ENG-1094) carries the agent's
                  // version in serverVersion — label it "Agent" so the card
                  // doesn't call an agent bump a "Server" update. Absent
                  // component ⇒ cowork-server, the historical default.
                  const serverPart = r.serverComponent === 'anton-agent' ? 'updates.software.agentPart' : 'updates.software.serverPart';
                  parts.push(t(serverPart, { version: r.serverVersion || t('updates.software.newVersion') }));
                }
                if (r.uiUpdateAvailable) parts.push(t('updates.software.uiPart', { version: r.uiVersion || t('updates.software.newVersion') }));
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
                      {checkingUpdates ? t('updates.software.checking') : t('updates.software.check')}
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
                        <span className="text-sm font-semibold text-ink">{t('updates.software.updateReady')}</span>
                        <span className="text-[11.5px] text-ink-3">
                          {parts.length > 0
                            ? t('updates.software.restartToApplyWith', { changes: parts.join(', ') })
                            : t('updates.software.restartToApply')}
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        onClick={handleApplyUpdateNow}
                        disabled={applyingUpdate}
                        style={{ cursor: applyingUpdate ? 'default' : 'pointer', opacity: applyingUpdate ? 0.7 : 1 }}
                      >
                        {applyingUpdate ? t('updates.software.restarting') : applyError ? t('updates.software.tryAgain') : t('updates.software.restartNow')}
                      </Button>
                    </div>
                  )}
                  {autoVisible && (
                    <div className={UPDATE_CARD_CLASS}>
                      <div className={UPDATE_CARD_BODY_CLASS}>
                        <span className="text-sm font-semibold text-ink">
                          {autoPhase === 'checking'
                            ? t('updates.software.auto.checking')
                            : autoPhase === 'available'
                              ? t('updates.software.auto.available')
                              : autoPhase === 'downloading'
                                ? (shellAutoUpdate.progress?.percent != null
                                  ? t('updates.software.auto.downloadingPercent', { percent: Math.round(shellAutoUpdate.progress.percent) })
                                  : t('updates.software.auto.downloading'))
                                : autoPhase === 'ready-to-install'
                                  ? t('updates.software.auto.ready')
                                  : autoPhase === 'installing'
                                    ? t('updates.software.auto.installing')
                                    : t('updates.software.auto.failed')}
                        </span>
                        <span className={`text-[11.5px] ${autoPhase === 'failed' || (autoPhase === 'ready-to-install' && shellAutoUpdate.errorCode) ? 'text-warning' : 'text-ink-3'}`}>
                          {autoPhase === 'ready-to-install'
                            ? (shellAutoUpdate.errorCode
                              // The last Restart never left the process (ENG-3291): the
                              // sidecar was stopped and started again, and the update is
                              // still downloaded. Say why, or the card just reads "ready" again.
                              ? abortedInstallHint(shellAutoUpdate.errorMessage, sharedTranslator('app'))
                              : t('updates.software.auto.readyHint', { product: shortName }))
                            : autoPhase === 'failed'
                              ? (shellAutoUpdate.errorMessage || t('updates.software.auto.failedHint'))
                              : autoPhase === 'available'
                                ? (shellAutoUpdate.mode === 'manual' ? t('updates.software.auto.availableManualHint') : t('updates.software.auto.availableHint'))
                                : t('updates.software.auto.workingHint', { product: shortName })}
                        </span>
                      </div>
                      {autoPhase === 'available' && (
                        <Button variant="primary" onClick={onDownloadShellAutoUpdate}>{t('updates.software.auto.download')}</Button>
                      )}
                      {autoPhase === 'ready-to-install' && (
                        <Button variant="primary" onClick={onInstallShellAutoUpdate}>
                          {shellAutoUpdate.errorCode ? t('updates.software.tryAgain') : t('updates.software.restartNow')}
                        </Button>
                      )}
                      {autoPhase === 'failed' && shellAutoUpdate.recoverable && (
                        <Button variant="primary" onClick={onRetryShellAutoUpdate}>{t('updates.software.auto.retry')}</Button>
                      )}
                    </div>
                  )}
                  {manualFallback && (
                    <div className={UPDATE_CARD_CLASS}>
                      <div className={UPDATE_CARD_BODY_CLASS}>
                        <span className="text-sm font-semibold text-ink">
                          {shellVersion ? t('updates.software.newAppVersion', { version: shellVersion }) : t('updates.software.auto.available')}
                        </span>
                        <span className="text-[11.5px] text-ink-3">
                          {manualHint}
                        </span>
                      </div>
                      <Button
                        variant={shellDownloadStarted ? 'subtle' : 'primary'}
                        onClick={() => { onDownloadShellUpdate(shellUrl); if (shellVersion) setShellDownloadedVersion(shellVersion); }}
                                              >
                        {shellDownloadStarted ? t('updates.software.downloadAgain') : t('updates.software.downloadInstaller')}
                      </Button>
                    </div>
                  )}
                  {applyError && (
                    <span className="text-sm text-warning">
                      {t('updates.software.applyFailed')}
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
