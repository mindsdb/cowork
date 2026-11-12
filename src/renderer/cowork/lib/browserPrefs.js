// The browser's preferences, as the app holds them now: whether the person
// approves the agent's consequential browser steps (a purchase, a message, a
// submit, a click by position) on a chat card. The choice is the person's
// server-side setting `browser_approve_steps` (settings.browserApproveSteps,
// beside browserEnabled), so every device and tab reads the same one; App.jsx
// feeds it in here whenever settings change. Anything but an explicit `false`
// asks: a server that predates the setting, or settings not read yet, never
// let the app approve a held step for the person (lib/browserApproval.js).

import { useSyncExternalStore } from 'react';

// The device-local copy this replaced: dropped once, never read.
const LEGACY_KEY = 'cowork.browserSteps';
const listeners = new Set();
let current = { askToApprove: true };

/** Whether `settings` (App's, camelCase) have the person approve browser steps. */
export function asksToApprove(settings) {
  return settings?.browserApproveSteps !== false;
}

export function getBrowserPrefs() {
  return current;
}

/** Takes the person's settings as they are now (App.jsx, on every change). */
export function syncBrowserPrefs(settings) {
  const askToApprove = asksToApprove(settings);
  if (askToApprove === current.askToApprove) return;
  current = { ...current, askToApprove };
  listeners.forEach((fn) => fn(current));
}

export function subscribeBrowserPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBrowserPrefs() {
  return useSyncExternalStore(subscribeBrowserPrefs, getBrowserPrefs, getBrowserPrefs);
}

export function forgetLegacyBrowserPrefs() {
  try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* private window */ }
}

// For tests: back to asking.
export function resetBrowserPrefsForTests() {
  current = { askToApprove: true };
}
