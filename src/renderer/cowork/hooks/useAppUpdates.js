import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { host } from '../../platform/host';
import { deriveUpdateBanner } from '../../../shared/update-banner';
import { SHELL_DOWNLOAD_PAGE } from '../../../shared/shell-support';

// The app's self-update lifecycle, rendered from the one update state main
// keeps over the three independently-versioned pieces (OTA UI bundle, server,
// desktop shell): see src/shared/update-coordinator.ts. This hook is the one
// subscriber in the chat app. It derives the one banner the sidebar shows and
// Settings mirrors, and routes the one action. No-ops cleanly in web, where
// `host` never publishes a state.
//
// The server-online/health/`refreshData` cluster stays in App.jsx:
// `refreshData` is the app-wide data loader (it writes tasks, projects,
// artifacts, settings, …), so that half is not a self-contained move.

export function useAppUpdates() {
  const [updateState, setUpdateState] = useState(null);
  // The manual installer notice can be dismissed, per offered version.
  const [shellUpdateDismissed, setShellUpdateDismissed] = useState(() => {
    try { return localStorage.getItem('shellUpdateDismissedVersion') || ''; } catch { return ''; }
  });

  useEffect(() => host.watchUpdateState(setUpdateState), []);

  // Linux ships a .deb, which is installed rather than launched, so the
  // notice names the install command instead of saying to open it.
  const updateBanner = useMemo(() => deriveUpdateBanner(updateState, {
    dismissedManualVersion: shellUpdateDismissed || null,
    debInstaller: host.getPlatform() === 'linux',
  }), [updateState, shellUpdateDismissed]);

  // The one action. Opening the installer page is the renderer's own job;
  // everything else is main's, through the one apply, which picks reload or
  // relaunch for whatever is pending and asks first while tasks run.
  // Resolves to main's answer, 'cancelled', 'stale' when the clicked action
  // was no longer on offer (nothing ran; the next state push re-renders), or
  // 'busy' when a request is already out. One request at a time: the banner is not disabled until
  // main's progress push lands, so a double click must not send a second
  // apply behind the first, and the dropped click is not a failure.
  const applyInFlight = useRef(false);
  const handleUpdateAction = useCallback(async (action, hooks = {}) => {
    if (action === 'open-download-page') {
      // Note: bare downloads.mindshub.ai now 302s to the marketing homepage;
      // the real per-OS installer page lives at mindshub.ai/download. Old
      // shells never supply a downloadUrl, so this is the only link that
      // cohort ever gets.
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
