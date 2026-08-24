import { useState, useEffect, useCallback } from 'react';
import { host } from '../../platform/host';

// The app's self-update lifecycle, across the two independently-versioned
// pieces the renderer surfaces:
//   - OTA UI bundle (`updateStatus` + `handleApplyUpdate`)
//   - the desktop shell binary — both the download-only notice
//     (`shellUpdate` / `handleDownloadShellUpdate` / `dismissShellUpdate`)
//     and the electron-updater auto-update (`shellAutoUpdate` /
//     `handleShellAutoUpdateAction`)
// plus the main-process subscriptions that feed all three. No-ops cleanly in
// web, where `host` returns stubbed getters and noop unsubscribers.
//
// Extracted from App.jsx (ENG-1916). Behavior-preserving — every update
// setter was already confined to this cluster; nothing else in the component
// reads or writes it. The server-online/health/`refreshData` cluster stays in
// App.jsx: `refreshData` is the app-wide data loader (it writes tasks,
// projects, artifacts, settings, …), so that half is not a self-contained move.
export function useAppUpdates() {
  // OTA UI update state
  const [updateStatus, setUpdateStatus] = useState(null); // { phase, version }
  const [updateApplying, setUpdateApplying] = useState(false);
  // Download-only shell notice; dismissal is scoped to the offered version.
  const [shellUpdate, setShellUpdate] = useState(null); // { version, currentVersion, downloadUrl }
  const [shellAutoUpdate, setShellAutoUpdate] = useState(null);
  const [shellUpdateDismissed, setShellUpdateDismissed] = useState(() => {
    try { return localStorage.getItem('shellUpdateDismissedVersion') || ''; } catch { return ''; }
  });

  // ENG-850 shell updater snapshot. Pull once for renderer reload recovery,
  // then subscribe to the same authoritative main-process state.
  useEffect(() => {
    let cancelled = false;
    host.getShellAutoUpdate().then((snapshot) => {
      if (!cancelled) setShellAutoUpdate(snapshot);
    }).catch(() => {});
    const unsubscribe = host.onShellAutoUpdate((snapshot) => {
      if (!cancelled) setShellAutoUpdate(snapshot);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Listen for OTA update status pushed from main process. No-op in
  // web — host returns a noop unsubscriber there.
  useEffect(() => {
    return host.onUpdateStatus((status) => {
      if (status?.phase === 'shell-available') {
        setShellUpdate({ version: status.version, currentVersion: status.currentVersion, downloadUrl: status.downloadUrl });
        return;
      }
      setUpdateStatus(status);
    });
  }, []);

  // Recover a cached notice after an OTA reload drops the original push.
  useEffect(() => {
    let cancelled = false;
    host.getShellUpdate().then((s) => { if (!cancelled && s) setShellUpdate(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleApplyUpdate = useCallback(async () => {
    console.log('[ui-update] install clicked, applying update...');
    if (updateApplying) { console.log('[ui-update] already applying, skipping'); return; }
    setUpdateApplying(true);
    setUpdateStatus({ phase: 'downloading', version: updateStatus?.version });
    try {
      const result = await host.applyUpdate();
      console.log('[ui-update] applyUpdate result:', result);
      // Window will reload with the new bundle — no further action needed
    } catch (err) {
      console.error('[ui-update] applyUpdate failed:', err);
      setUpdateApplying(false);
      // Keep the version so the sidebar can offer a labelled retry rather than
      // going silent until the next poll.
      setUpdateStatus({ phase: 'error', version: updateStatus?.version });
    }
  }, [updateApplying, updateStatus]);

  // Settings can pass a URL; a bare click falls back to the cached notice, and
  // failing that to the human download page. Note: bare downloads.mindshub.ai
  // now 302s to the marketing homepage — the real per-OS installer page lives
  // at mindshub.ai/download. Old shells never supply a downloadUrl, so this
  // last fallback is the only link that cohort ever gets.
  const handleDownloadShellUpdate = useCallback((url) => {
    const explicit = typeof url === 'string' && url ? url : null;
    host.openExternal(explicit || shellUpdate?.downloadUrl || 'https://mindshub.ai/download');
  }, [shellUpdate]);

  const handleShellAutoUpdateDownload = useCallback(async () => {
    const snapshot = await host.downloadShellAutoUpdate().catch(() => null);
    if (snapshot) setShellAutoUpdate(snapshot);
  }, []);

  const handleShellAutoUpdateInstall = useCallback(async () => {
    await host.installShellAutoUpdate().catch(() => false);
  }, []);

  const handleShellAutoUpdateRetry = useCallback(async () => {
    const snapshot = await host.checkShellAutoUpdate().catch(() => null);
    if (snapshot) setShellAutoUpdate(snapshot);
  }, []);

  const handleShellAutoUpdateAction = useCallback(() => {
    switch (shellAutoUpdate?.phase) {
      case 'available':
        return handleShellAutoUpdateDownload();
      case 'ready-to-install':
        return handleShellAutoUpdateInstall();
      case 'failed':
        if (shellAutoUpdate.recoverable) return handleShellAutoUpdateRetry();
        return handleDownloadShellUpdate();
      default:
        return undefined;
    }
  }, [
    shellAutoUpdate,
    handleShellAutoUpdateDownload,
    handleShellAutoUpdateInstall,
    handleShellAutoUpdateRetry,
    handleDownloadShellUpdate,
  ]);

  const dismissShellUpdate = useCallback(() => {
    const v = shellUpdate?.version;
    if (!v) return;
    try { localStorage.setItem('shellUpdateDismissedVersion', v); } catch { /* private mode */ }
    setShellUpdateDismissed(v);
  }, [shellUpdate]);

  return {
    updateStatus,
    shellUpdate,
    shellAutoUpdate,
    shellUpdateDismissed,
    handleApplyUpdate,
    handleDownloadShellUpdate,
    handleShellAutoUpdateDownload,
    handleShellAutoUpdateInstall,
    handleShellAutoUpdateRetry,
    handleShellAutoUpdateAction,
    dismissShellUpdate,
  };
}
