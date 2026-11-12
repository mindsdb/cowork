// The browser's preferences, as the app holds them now: whether the person
// approves the agent's consequential browser steps (a purchase, a message, a
// submit) on a chat card; clicks by position never ask. The choice is the
// person's server-side setting `browser_approve_steps`
// (settings.browserApproveSteps, beside browserEnabled), so every device and
// tab reads the same one; App.jsx
// feeds it in here whenever settings change. Anything but an explicit `false`
// asks: a server that predates the setting, or settings not read yet, never
// let the app approve a held step for the person (lib/browserApproval.js).
//
// Also whether the browser shows only when the person is needed
// (`browser_only_when_needed`, settings.browserOnlyWhenNeeded): anything but
// an explicit `false` is on (views/ChatView.jsx, lib/browserSteps.js).

import { useSyncExternalStore } from 'react';

// The device-local copy this replaced: dropped once, never read.
const LEGACY_KEY = 'cowork.browserSteps';
const listeners = new Set();
const DEFAULTS = { askToApprove: true, onlyWhenNeeded: true };
let current = DEFAULTS;
/* Held-step cards the person turned approvals off from (the card's Skip
   approvals): the setting is for later steps, so the app never approves
   these for them, and each still shows until they answer it. */
const leftToPerson = new Set();
// App.jsx's saveSettings, which writes a setting to the server and to App.
let saver = null;

/** Whether `settings` (App's, camelCase) have the person approve browser steps. */
export function asksToApprove(settings) {
  return settings?.browserApproveSteps !== false;
}

/** Whether `settings` show the browser only when the person is needed. */
export function showsOnlyWhenNeeded(settings) {
  return settings?.browserOnlyWhenNeeded !== false;
}

export function getBrowserPrefs() {
  return current;
}

/** Takes the person's settings as they are now (App.jsx, on every change). */
export function syncBrowserPrefs(settings) {
  const next = { askToApprove: asksToApprove(settings), onlyWhenNeeded: showsOnlyWhenNeeded(settings) };
  if (next.askToApprove === current.askToApprove && next.onlyWhenNeeded === current.onlyWhenNeeded) return;
  current = { ...current, ...next };
  listeners.forEach((fn) => fn(current));
}

export function subscribeBrowserPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBrowserPrefs() {
  return useSyncExternalStore(subscribeBrowserPrefs, getBrowserPrefs, getBrowserPrefs);
}

/** Whether the person turned approvals off from this card: it stays theirs to answer. */
export function isLeftToPerson(questionId) {
  return leftToPerson.has(questionId);
}

/** App.jsx hands in how settings are saved; returns how to take it back. */
export function setBrowserSettingSaver(save) {
  saver = save;
  return () => { if (saver === save) saver = null; };
}

/**
 * Turns Approve browser steps on or off from a held step's card (its Skip
 * approvals), saved like the switch in Settings. Turning it off leaves that
 * card to the person. Resolves with whether the setting was saved.
 *
 * @param {boolean} ask
 * @param {string | null} [questionId] the card it was turned off from
 * @returns {Promise<boolean>}
 */
export async function saveApproveSteps(ask, questionId = null) {
  if (!saver) return false;
  if (!ask && questionId) leftToPerson.add(questionId);
  try {
    await saver({ browserApproveSteps: ask });
    return true;
  } catch {
    return false;
  }
}

export function forgetLegacyBrowserPrefs() {
  try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* private window */ }
}

// For tests: back to the defaults.
export function resetBrowserPrefsForTests() {
  current = DEFAULTS;
  leftToPerson.clear();
  saver = null;
}
