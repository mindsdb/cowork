import { useState } from 'react';
import { host } from '../../platform/host';
import { resetDeviceIdentity } from '../lib/analytics';

// Confirm-dialog copy for signing out — shared by every sign-out entry point
// (settings Account section, sidebar user menu) so the warning about cleared
// credentials can't drift between them.
export const LOGOUT_CONFIRM_COPY = {
  title: 'Sign out of Cowork?',
  message: "This clears your stored API keys and disconnects from MindsHub. You'll need to sign in again to keep using Cowork.",
  confirmLabel: 'Sign out',
};

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
    // Exactly ONE reload must happen, or two compete and leave the page stuck
    // on the confirm modal (flaky in packaged builds). On Electron SUCCESS the
    // main process drives webContents.reload() after the IPC reply, so the
    // renderer must NOT also reload. We reload here only when nothing else
    // will: on web (no main process), and on an Electron REJECTION — main threw
    // before its own reload, and since the user is already signed out a
    // renderer reload is race-free and re-routes to onboarding (the correct end
    // state) rather than a misleading "sign-out didn't complete". (ENG-1206)
    if (host.isWeb || !ok) {
      window.location.reload();
    }
  };

  return { loggingOut, logout };
}
