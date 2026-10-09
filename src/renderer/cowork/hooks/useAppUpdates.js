import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { host } from '../../platform/host';
import { deriveUpdateBanner } from '../../../shared/update-banner';
import { SHELL_DOWNLOAD_PAGE } from '../../../shared/shell-support';

// The chat app's view of the update state: the sidebar banner and its action.
// No-ops in web, where `host` never publishes a state.
//
// The server-online/health/`refreshData` cluster stays in App.jsx:
// `refreshData` is the app-wide data loader (it writes tasks, projects,
// artifacts, settings, …), so that half is not a self-contained move.

export function useAppUpdates() {
  const [updateState, setUpdateState] = useState(null);
  const [shellUpdateDismissed, setShellUpdateDismissed] = useState(() => {
    try { return localStorage.getItem('shellUpdateDismissedVersion') || ''; } catch { return ''; }
  });

  useEffect(() => host.watchUpdateState(setUpdateState), []);

  const updateBanner = useMemo(() => deriveUpdateBanner(updateState, {
    dismissedManualVersion: shellUpdateDismissed || null,
    debInstaller: host.getPlatform() === 'linux',
  }), [updateState, shellUpdateDismissed]);

  // One request at a time: the banner stays enabled until main's progress push
  // lands, so a second click answers 'busy' rather than queuing another apply.
  const applyInFlight = useRef(false);
  const handleUpdateAction = useCallback(async (action, hooks = {}) => {
    if (action === 'open-download-page') {
      // Old shells never supply a downloadUrl, so this is their only link.
      const explicit = typeof hooks.url === 'string' && hooks.url ? hooks.url : null;
      host.openExternal(explicit || updateState?.shell?.manualDownloadUrl || SHELL_DOWNLOAD_PAGE);
      return true;
    }
    if (!action) return false;
    if (applyInFlight.current) return 'busy';
    applyInFlight.current = true;
    try {
      return await host.applyUpdates({ onProceed: hooks.onProceed, action });
    } catch (err) {
      console.error('[updates] apply failed:', err);
      return false;
    } finally {
      applyInFlight.current = false;
    }
  }, [updateState]);

  const dismissShellUpdate = useCallback(() => {
    const v = updateState?.shell?.manual ? updateState.shell.version : null;
    if (!v) return;
    try { localStorage.setItem('shellUpdateDismissedVersion', v); } catch { /* private mode */ }
    setShellUpdateDismissed(v);
  }, [updateState]);

  return {
    updateState,
    updateBanner,
    shellUpdateDismissed,
    handleUpdateAction,
    dismissShellUpdate,
  };
}
