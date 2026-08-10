import { useState, useEffect } from 'react';
import Ico from '../../components/Icons';
import { Button } from '../../components/ui';
import { copyText as copyToClipboard } from '../../lib/clipboard';
import { fetchHealth } from '../../api';
import { host, getVersionInfo, isElectron } from '../../../platform/host';
import { unifiedVersion, SKEW_WARN_DAYS } from '../../../../shared/version';
import { Section, SettingsSectionPanel } from './settingsLayout';

const UPDATE_CARD_STYLE = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '10px 12px', border: '1px solid rgba(93,146,135,0.30)',
  background: 'rgba(93,146,135,0.12)', borderRadius: 8,
};
const UPDATE_CARD_BODY_STYLE = { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 160 };

// The Updates settings section: current-version readout plus the on-demand
// update check/apply flow. Self-contained — it owns every piece of state its
// UI needs (versions, the check result, in-flight/applied flags), so nothing
// here leaks into the rest of SettingsView. The Save `footer` is rendered by
// the parent and passed through, and the shell (installer) update hand-off
// comes in via `shellUpdate` / `onDownloadShellUpdate`.
export default function UpdatesSection({ footer, serverOnline = false, shellUpdate = null, onDownloadShellUpdate }) {
  const [versionInfo, setVersionInfo] = useState({ app: '', ui: null, source: 'web' });
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
  // The shell (installer) download is a hand-off to the browser — we can't
  // detect when it finishes, so once the user triggers it for a given version
  // we flip the card to the quit-and-open guidance. Keyed by version so a newer
  // shell notice later in the session starts fresh instead of showing stale
  // "downloading…" copy for a version that was never fetched.
  const [shellDownloadedVersion, setShellDownloadedVersion] = useState(null);

  useEffect(() => { getVersionInfo().then(setVersionInfo).catch(() => { }); }, []);
  // Backend (server + agent) versions come from /health, which is only
  // reachable when the backend is up. Re-read whenever the section mounts and
  // the backend is online, so versions populate after a cold open or a
  // start/restart from the Backend section instead of staying blank.
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
      <div style={{
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)',
        background: 'var(--surface-glass)',
        WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
        backdropFilter: 'blur(var(--surface-glass-blur))',
        marginBottom: 14, overflow: 'hidden', padding: '0 18px 8px',
      }}>
        <Section
          title="Current version"
          subtitle="The version currently running. Server and UI updates are applied automatically at launch; components under the hood are shown in details."
        >
          {(() => {
            const baked = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
            // App shell = installed Electron shell (changes only on reinstall).
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
            // excluded — it updates via reinstall and is shown on its own line.
            const unified = unifiedVersion([uiVer, serverVersion, antonVersion]);
            const outOfSync = !!unified && unified.skewDays >= SKEW_WARN_DAYS;
            const rows = [
              ['App shell', shellVer || '—'],
              ['UI', uiVer ? `${uiVer} (${uiSource})` : '—'],
              ['Server', serverVersion || '—'],
              ['Agent', antonVersion || '—'],
            ];
            const copyText = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: 'var(--text-strong)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span title={unified ? `Release week ${unified.cycleRange}` : undefined} style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
                    {unified ? unified.label : (shellVer || '—')}
                  </span>
                  {outOfSync && (
                    <span
                      title={`Underlying components span ${unified.skewDays} days — a component is lagging. See details.`}
                      style={{ color: 'var(--warning)', fontSize: 11.5, fontWeight: 600 }}
                    >
                      ⚠ out of sync
                    </span>
                  )}
                  {unified && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>built {unified.buildDate}</span>
                  )}
                </div>
                {isElectron && (
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 12 }}>
                    <span style={{ marginRight: 4 }}>App shell</span>{shellVer || '—'}
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
                  style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 11.5 }}
                >
                  {showVersionDetails ? 'Hide details' : 'Details'}
                </button>
                {showVersionDetails && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--surface-glass)' }}>
                    {rows.map(([k, v]) => (
                      <span key={k} style={{ userSelect: 'text' }}>
                        <span style={{ color: 'var(--text-muted)', marginRight: 6, display: 'inline-block', minWidth: 64 }}>{k}</span>{v}
                      </span>
                    ))}
                    {/* role="status"/aria-live wraps the button itself (unlike
                        ApiKeyInput's separate pill) because the failure text
                        here IS the button's label — without a live region a
                        screen reader has no guarantee it announces a focused
                        button's label changing out from under it. */}
                    <span role="status" aria-live="polite" style={{ alignSelf: 'flex-start' }}>
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
                        style={{ marginTop: 4 }}
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
            subtitle="UI and server updates apply automatically when the app restarts. Only a new app version has to be downloaded and reinstalled by hand."
          >
            {(() => {
              const r = checkResult;
              const shellPending = r?.ok ? !!r.shellUpdateAvailable : !!shellUpdate;
              const shellVersion = r?.shellVersion || shellUpdate?.version;
              const shellUrl = r?.shellDownloadUrl || shellUpdate?.downloadUrl;
              const shellDownloadStarted = shellPending && !!shellVersion && shellDownloadedVersion === shellVersion;
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
              const applyAvailable = !checkingUpdates && !!r && r.ok && (r.uiUpdateAvailable || r.serverUpdateAvailable);
              const busy = checkingUpdates || applyingUpdate;
              const parts = [];
              if (applyAvailable) {
                if (r.serverUpdateAvailable) parts.push(`Server → ${r.serverVersion || 'new version'}`);
                if (r.uiUpdateAvailable) parts.push(`UI → ${r.uiVersion || 'new version'}`);
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <Button
                      onClick={handleCheckForUpdates}
                      disabled={busy}
                      style={{ minWidth: 150, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}
                    >
                      {checkingUpdates ? 'Checking…' : 'Check for updates'}
                    </Button>
                    {status && (
                      <span style={{ fontSize: 12.5, color: isError ? 'var(--warning)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {isUpToDate && Ico.check ? Ico.check(14) : null}
                        {status}
                      </span>
                    )}
                  </div>
                  {applyAvailable && (
                    <div style={UPDATE_CARD_STYLE}>
                      <div style={UPDATE_CARD_BODY_STYLE}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)' }}>Update ready</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
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
                  {shellPending && (
                    <div style={UPDATE_CARD_STYLE}>
                      <div style={UPDATE_CARD_BODY_STYLE}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)' }}>
                          {shellVersion ? `New app version ${shellVersion}` : 'New app version available'}
                        </span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {shellDownloadStarted
                            ? "Installer downloading — when it's done, quit MindsHub Cowork and open the installer to finish updating."
                            : "Download the installer, then quit MindsHub Cowork and open it to finish updating."}
                        </span>
                      </div>
                      <Button
                        variant={shellDownloadStarted ? 'subtle' : 'primary'}
                        onClick={() => { onDownloadShellUpdate(shellUrl); if (shellVersion) setShellDownloadedVersion(shellVersion); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {shellDownloadStarted ? 'Download again' : 'Download installer'}
                      </Button>
                    </div>
                  )}
                  {applyError && (
                    <span style={{ fontSize: 12.5, color: 'var(--warning)' }}>
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
