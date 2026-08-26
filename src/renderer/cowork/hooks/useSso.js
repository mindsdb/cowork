import { useState, useEffect, useRef } from 'react';
import { host, getAccessToken } from '../../platform/host';
import { trackKeyProvisioningRefused } from '../lib/analytics';

// MindsHub SSO: the signed-in flag, the last sign-in error (painted on the
// Settings account card), and the sign-in flow (login → key provisioning).
// Authoritative connected-state comes from the main process via
// onMindsHubAuthChanged; the settings-open probe seeds it when the card is
// first shown.
//
// The caller supplies `settingsOpen` (so the probe re-runs when Settings
// opens) plus the setters used to surface a failure on the account card and
// the app-wide `refreshData` to run after a successful sign-in.
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

  // Authoritative signed-in state, pushed from the main process on every
  // token-store transition (login, silent refresh, logout, session
  // death). The UI no longer depends solely on the promise of whichever
  // call initiated the sign-in — that promise can be lost (ENG-761)
  // while the main process is in fact authenticated, or vice versa.
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
        // The result is still not acted on — key provisioning is not a sign-in
        // gate — but a refusal is now countable (ENG-1533). A 402 here leaves the
        // user signed in with no working key, no BYOK route and no message; the
        // `unhandled` outcome is how often that happens. Fixing the UX needs its
        // own ticket; this only makes it visible.
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
