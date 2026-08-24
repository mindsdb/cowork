import { useState } from 'react';
import { host } from '../../platform/host';
import { resetDeviceIdentity } from '../lib/analytics';

// Confirm-dialog copy for signing out — shared by every sign-out entry point
// (settings Account section, sidebar user menu) so the wording can't drift
// between them. The message is platform-aware: Electron clears stored
// credentials on the device, while web only ends the Keycloak browser session
// (keys live in MindsHub, not on the machine), so the desktop warning about
// cleared API keys would be false there.
export const LOGOUT_CONFIRM_COPY = {
  title: 'Sign out of Cowork?',
  message: host.isWeb
    ? "This signs you out of Cowork. You'll need to sign in again with MindsHub to keep using it."
    : "This clears your stored API keys and disconnects from MindsHub. You'll need to sign in again to keep using Cowork.",
  confirmLabel: 'Sign out',
};

// Grace window before the Electron success path self-heals with its own
// reload — long enough that a healthy main reload wins first (see below).
export const LOGOUT_RELOAD_FALLBACK_MS = 2500;

// The sign-out flow, extracted from the settings Account section so the
// sidebar user menu (ENG-1408) runs the exact same sequence.
export function useLogout() {
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    if (loggingOut) return; // Guard against double-fire (Enter / re-click).
    setLoggingOut(true);
    let ok = true;
    try {
      await host.logout();
    } catch {
      // logout() rejected. The main handler clears the refresh token + the
      // server-DB credentials early, before anything that can throw, so the
      // user IS signed out — main just threw before it could drive its own
      // reload. Fall through and reload from here (see below).
      ok = false;
    }
    // Rotate the analytics device identity so the next account on this machine
    // starts anonymous-fresh (ENG-537) — only on a confirmed sign-out, not on
    // a rejected attempt (which would otherwise re-rotate on every retry).
    if (ok) {
      resetDeviceIdentity();
    }
    // Exactly ONE navigation must happen, and on SUCCESS the platform drives
    // it: Electron main calls webContents.reload(), web's keycloak.logout()
    // redirects to the end-session endpoint. A renderer reload here would race
    // and win — cancelling the web redirect (SSO cookie survives → silent
    // re-auth) or double-reloading Electron into a stuck modal. So we reload
    // immediately only on REJECTION, where the platform threw before its own
    // navigation and nothing else will. (ENG-1206)
    if (!ok) {
      window.location.reload();
      return;
    }
    // Electron watchdog: main's single reload is all that clears the
    // "Signing out…" modal, and if it's dropped (intermittently on Windows)
    // the modal is stuck forever — Esc/Cancel are disabled while busy. A
    // healthy main reload tears this timer down first, so this fires only as
    // recovery, never racing into a double reload. Web is excluded (a renderer
    // reload would cancel keycloak's redirect).
    if (host.isElectron) {
      setTimeout(() => window.location.reload(), LOGOUT_RELOAD_FALLBACK_MS);
    }
  };

  return { loggingOut, logout };
}
