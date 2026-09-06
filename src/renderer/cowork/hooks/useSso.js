import { useState, useEffect, useRef } from 'react';
import { host, getAccessToken } from '../../platform/host';
import { trackKeyProvisioningRefused } from '../lib/analytics';

// Main-process auth events are authoritative; opening Settings seeds state with a fresh probe.
// Successful login/key provisioning refreshes app data.
export function useSso({ settingsOpen, setSettingsSection, setSettingsOpen, refreshData }) {
  const [ssoConnected, setSsoConnected] = useState(false);
  const [ssoError, setSsoError] = useState('');
  // Re-entry guard: a second "Sign in" click while a browser flow is
  // already open would spawn a second loopback attempt.
  const ssoBusyRef = useRef(false);

  useEffect(() => {
    if (!settingsOpen) return;
    getAccessToken().then((token) => setSsoConnected(!!token)).catch(() => {});
  }, [settingsOpen]);

  // Follow all main-process token transitions; the initiating sign-in promise can be lost while
  // authentication succeeds.
  useEffect(() => {
    if (!host.isElectron) return undefined;
    return host.onMindsHubAuthChanged(({ authenticated }) => {
      setSsoConnected(!!authenticated);
      if (authenticated) setSsoError('');
    });
  }, []);

  const handleSsoSignIn = async () => {
    if (!host.isElectron || ssoBusyRef.current) return;
    ssoBusyRef.current = true;
    setSsoError('');
    try {
      const loginResult = await host.mindshubLogin();
      if (!loginResult?.ok) {
        // ENG-761: this used to silently return — the browser said
        // "You're authorized!" while the app showed nothing. Surface the
        // failure where the user will look for it: the account card.
        setSsoError(String(loginResult?.reason || 'Sign in failed. Please try again.'));
        setSettingsSection('account');
        setSettingsOpen(true);
        return;
      }
      // Signed in — flip the UI now; key provisioning below takes several
      // seconds (org bootstrap + server restart) and is not a sign-in gate.
      setSsoConnected(true);
      try {
        // Provisioning refusal does not gate sign-in; record unhandled when authentication succeeds
        // without a working key.
        const finalizeResult = await host.mindshubFinalize();
        if (finalizeResult?.upgradeRequired) trackKeyProvisioningRefused('unhandled');
      } catch (e) {
        console.warn('[sso] finalize failed after sign-in (account is authenticated):', e);
      }
      refreshData();
    } finally {
      ssoBusyRef.current = false;
    }
  };

  return { ssoConnected, ssoError, handleSsoSignIn };
}
