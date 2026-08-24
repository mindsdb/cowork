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

// How long the Electron success path waits for main's webContents.reload()
// before self-healing with its own reload. Must comfortably exceed a healthy
// main reload (which destroys the page first) so the fallback only fires when
// that reload was genuinely dropped — never racing it into a double reload.
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
    // Exactly ONE navigation must happen. On SUCCESS the platform drives it and
    // the renderer must NOT also navigate immediately, or the two race and the
    // renderer's wins: Electron's main process calls webContents.reload() after
    // the IPC reply, and web's keycloak.logout() calls window.location.replace()
    // to the end-session endpoint. A renderer reload() here runs in a microtask
    // before the browser performs that replace(), cancelling the redirect — the
    // SSO cookie is still valid, login-required silently re-auths, and the user
    // lands right back in the app ("sign-out had no effect"). We reload
    // immediately only on REJECTION, where nothing else will: the platform threw
    // before its own navigation, the user is already signed out, so a renderer
    // reload re-routes to onboarding / the login screen rather than a misleading
    // stuck modal. (ENG-1206)
    if (!ok) {
      window.location.reload();
      return;
    }
    // Electron success watchdog. On Electron the ONLY thing that clears the
    // "Signing out…" modal is main's single deferred webContents.reload()
    // (index.ts AUTH_LOGOUT). `loggingOut` is never reset here, so if that one
    // reload is dropped — intermittently on Windows — the modal is trapped on
    // "Signing out…" forever even though the account is already signed out, and
    // ConfirmModal blocks Esc/Cancel/backdrop while busy. A healthy main reload
    // tears this page (and this timer) down long before the delay elapses, so
    // this fires only as a last-resort recovery and can't reintroduce the
    // double-reload race the immediate reload above avoids. Web is excluded:
    // keycloak owns the redirect there and a renderer reload would cancel it.
    if (host.isElectron) {
      setTimeout(() => window.location.reload(), LOGOUT_RELOAD_FALLBACK_MS);
    }
  };

  return { loggingOut, logout };
}
