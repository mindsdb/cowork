import { useSyncExternalStore } from 'react';
import { host } from '../../platform/host';
import { resetDeviceIdentity } from '../lib/analytics';

// Share sign-out copy across entry points; only desktop clears local API keys, while web ends the
// browser session.
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

/* Unlock dismissal after this deadline even if platform sign-out is still running. */
export const LOGOUT_BUSY_LOCK_MS = 8_000;

/*
 * The renderer cannot observe main's current logout step; keep pending copy independent of
 * implementation stages.
 */
export const LOGOUT_WAIT_NOTE = 'Still signing you out. You can close this — it finishes on its own.';

/*
 * Share one in-flight logout across entry points so dismissing a busy modal cannot permit a second
 * AUTH_LOGOUT.
 * settling tracks the platform reply; locked separately bounds how long the modal refuses
 * dismissal.
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
    // On success the platform owns navigation. A renderer reload would cancel web logout or
    // double-reload Electron.
    // Reload immediately only after rejection, when the platform did not navigate.
    if (!ok) {
      window.location.reload();
      return;
    }
    // Recover an Electron reply whose main-process reload was lost; a successful reload destroys
    // this timer first.
    // Never use this watchdog on web: it would cancel Keycloak's logout redirect.
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
