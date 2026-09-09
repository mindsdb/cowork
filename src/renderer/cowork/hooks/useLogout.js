import { useSyncExternalStore } from 'react';
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

/*
 * How long the confirm dialog stays locked shut before it hands the keyboard
 * back, whatever the platform is still doing. Under the 10 seconds a person
 * is asked to wait without a way out.
 *
 * The sign-out this waits on is bounded by its own steps — a Keycloak revoke,
 * a credential clear, the sidecar's DB clear — and none of them is the sidecar
 * restart any more, so on a healthy machine the reply beats this timer and it
 * never fires. It is insurance, not the normal path.
 */
export const LOGOUT_BUSY_LOCK_MS = 8_000;

/*
 * Shown once the dialog is dismissable but the sign-out has not replied. It
 * says what is still true rather than naming a step, because the renderer
 * cannot see which step main is on and a wrong guess reads worse than none.
 */
export const LOGOUT_WAIT_NOTE = 'Still signing you out. You can close this — it finishes on its own.';

/*
 * Sign-out state lives in a module store, not in `useState`, because two
 * components mount this hook (the settings Account section and the sidebar
 * user menu) and each used to get its own copy. That was invisible while the
 * dialog was locked shut for the whole sign-out; now that it can be dismissed
 * mid-flight, a second entry point would happily fire a second AUTH_LOGOUT.
 * Same idiom as src/renderer/lib/orgMode.ts.
 *
 * `settling` is "the platform has not answered yet" and drives the spinner.
 * `locked` is "the dialog refuses to close" and is the half with a deadline.
 * Splitting them is what lets the work continue while the person walks away.
 */
let state = { settling: false, locked: false };
const listeners = new Set();
let inFlight = null;
let lockTimer = null;

function publish(next) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function getSnapshot() {
  return state;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function releaseLock() {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
}

// The sign-out flow, extracted from the settings Account section so the
// sidebar user menu (ENG-1408) runs the exact same sequence.
async function runLogout() {
  // Guard against double-fire (Enter / re-click), and against the second
  // entry point firing while the first is still in flight.
  if (inFlight) return inFlight;
  publish({ settling: true, locked: true });
  lockTimer = setTimeout(() => {
    lockTimer = null;
    publish({ locked: false });
  }, LOGOUT_BUSY_LOCK_MS);

  inFlight = (async () => {
    let ok = true;
    try {
      await host.logout();
    } catch {
      // logout() rejected. The main handler clears the refresh token + the
      // server-DB credentials early, before anything that can throw, so the
      // user IS signed out — main just threw before it could drive its own
      // reload. Fall through and reload from here (see below).
      ok = false;
    } finally {
      // Whatever happened, the dialog stops being the app's only exit. There
      // is no path here that leaves `settling` or `locked` set with nothing
      // but a page reload to clear them, which is what trapped the tester.
      releaseLock();
      publish({ settling: false, locked: false });
      inFlight = null;
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
    // the modal is stuck forever. A healthy main reload tears this timer down
    // first, so this fires only as recovery, never racing into a double
    // reload. Web is excluded (a renderer reload would cancel keycloak's
    // redirect). It covers a reply that arrived and a reload that did not,
    // which the lock above cannot see.
    if (host.isElectron) {
      setTimeout(() => window.location.reload(), LOGOUT_RELOAD_FALLBACK_MS);
    }
  })();
  return inFlight;
}

export function useLogout() {
  const { settling, locked } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    loggingOut: settling,
    locked,
    waitNote: settling && !locked ? LOGOUT_WAIT_NOTE : '',
    logout: runLogout,
  };
}
